-- MenuNext — teste de regressão: movimentações do caixa (suprimento e sangria) e conciliação.
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO. Tudo acontece num bloco que SEMPRE termina com `raise exception`
-- (nada persiste). Resultado: a mensagem final do erro ("RESULTADO: OK | N verificacoes" ou "FALHOU").
--
-- Regras testadas: tabela fechada; membros (OWNER e STAFF) registram na PRÓPRIA loja; estranho, outra loja e
-- visitante não; só com caixa aberto; sangria não passa do disponível; valores/motivos inválidos recusados;
-- dinheiro esperado = abertura + vendas em dinheiro + suprimentos - sangrias (cash_current e cash_close, e o valor
-- gravado no histórico); listagem: sessão aberta para membros, sessão fechada só OWNER; nada é editável/apagável.

create or replace function pg_temp._runas(p_role text, p_uid uuid, p_stmt text) returns text
language plpgsql as $$
declare v_res text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_stmt into v_res;
  exception when others then
    v_res := 'ERR: ' || sqlerrm;
  end;
  execute 'reset role';
  return v_res;
end $$;

do $$
declare
  u_owner_a uuid := gen_random_uuid();
  u_staff_a uuid := gen_random_uuid();
  u_owner_b uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  r_a uuid; r_b uuid; sid uuid;
  res text;
  fails text[] := '{}'; total int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_owner_a, 'owner-a@cm.test', jsonb_build_object('name','Dona A','phone','11999990001','document','12345678062')),
    (u_staff_a, 'staff-a@cm.test', jsonb_build_object('name','Equipe A','phone','11999990002','document','98765432029')),
    (u_owner_b, 'owner-b@cm.test', jsonb_build_object('name','Dono B','phone','11999990003','document','24681357090')),
    (u_stranger,'stranger@cm.test',jsonb_build_object('name','Estranho','phone','11999990005','document','86420975310'));
  update public.profiles set trial_ends_at = now() + interval '30 days' where user_id in (u_owner_a, u_owner_b);
  insert into public.restaurants (name, slug) values ('Loja A', 'cm-a') returning id into r_a;
  insert into public.restaurants (name, slug) values ('Loja B', 'cm-b') returning id into r_b;
  insert into public.restaurant_members (restaurant_id, user_id, role) values
    (r_a, u_owner_a, 'OWNER'), (r_a, u_staff_a, 'STAFF'), (r_b, u_owner_b, 'OWNER');

  -- ---------- 0) catálogo ----------
  total := total + 1;
  if not exists (select 1 from pg_class where oid = 'public.cash_movements'::regclass and relrowsecurity) then fails := fails || 'cash_movements sem RLS'::text; end if;
  total := total + 1;
  if has_table_privilege('anon','public.cash_movements','SELECT') or has_table_privilege('authenticated','public.cash_movements','SELECT')
     or has_table_privilege('authenticated','public.cash_movements','INSERT') or has_table_privilege('authenticated','public.cash_movements','UPDATE')
     or has_table_privilege('authenticated','public.cash_movements','DELETE') then
    fails := fails || 'cash_movements tem privilegio direto'::text;
  end if;
  total := total + 1;
  if has_function_privilege('anon','public.cash_record_movement(text,numeric,text)','EXECUTE')
     or has_function_privilege('anon','public.cash_movements_list(uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.cash_record_movement(text,numeric,text)','EXECUTE')
     or has_function_privilege('authenticated','public._cash_movement_totals(uuid)','EXECUTE') then
    fails := fails || 'privilegios de EXECUTE incorretos'::text;
  end if;

  -- ---------- 1) caixa fechado / sem permissão ----------
  res := pg_temp._runas('authenticated', u_staff_a, $s$select public.cash_record_movement('supply', 10, 'troco')::text$s$);
  total := total + 1;
  if res not ilike '%cash_not_open%' then fails := fails || format('movimento com caixa fechado deveria ser recusado (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_stranger, $s$select public.cash_record_movement('supply', 10, 'troco')::text$s$);
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('usuario sem loja registrou movimento (%s)', res); end if;
  res := pg_temp._runas('anon', null, $s$select public.cash_record_movement('supply', 10, 'troco')::text$s$);
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('visitante executou cash_record_movement (%s)', res); end if;

  -- ---------- 2) abre o caixa da loja A com 100 ----------
  res := pg_temp._runas('authenticated', u_staff_a, 'select public.cash_open(100)::text');
  sid := res::uuid;
  -- venda em dinheiro de 50 e venda no Pix de 30 (só a primeira entra no dinheiro esperado)
  insert into public.orders (restaurant_id, order_number, customer_name, customer_phone, fulfillment_type, payment_method, subtotal, total, status, idempotency_key, created_at) values
    (r_a, 1, 'Balcao', '11999990001', 'counter', 'cash', 50, 50, 'received', 'cm-1', now()),
    (r_a, 2, 'Balcao', '11999990001', 'counter', 'pix',  30, 30, 'received', 'cm-2', now());

  total := total + 1;
  res := pg_temp._runas('authenticated', u_staff_a, 'select expected_cash::text from public.cash_current()');
  if res::numeric <> 150 then fails := fails || format('esperado antes das movimentacoes deveria ser 150 (%s)', res); end if;

  -- ---------- 3) registros válidos ----------
  res := pg_temp._runas('authenticated', u_staff_a, $s$select public.cash_record_movement('supply', 20, 'troco inicial extra')::text$s$);
  total := total + 1;
  if res like 'ERR:%' then fails := fails || format('STAFF nao registrou suprimento (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, $s$select public.cash_record_movement('withdrawal', 30.50, 'sangria ao cofre')::text$s$);
  total := total + 1;
  if res like 'ERR:%' then fails := fails || format('OWNER nao registrou sangria (%s)', res); end if;

  res := pg_temp._runas('authenticated', u_staff_a, 'select expected_cash::text from public.cash_current()');
  total := total + 1;
  if res::numeric <> 139.50 then fails := fails || format('esperado = 100 + 50 + 20 - 30,50 = 139,50 (%s)', res); end if;

  total := total + 1;
  if not exists (select 1 from public.cash_movements where session_id = sid and kind = 'supply' and amount = 20 and created_by = u_staff_a)
     or not exists (select 1 from public.cash_movements where session_id = sid and kind = 'withdrawal' and amount = 30.50 and created_by = u_owner_a) then
    fails := fails || 'movimentos nao gravaram tipo, valor e autor'::text;
  end if;

  -- ---------- 4) recusas ----------
  res := pg_temp._runas('authenticated', u_staff_a, $s$select public.cash_record_movement('withdrawal', 139.51, 'tudo')::text$s$);
  total := total + 1;
  if res not ilike '%insufficient_cash%' then fails := fails || format('sangria acima do disponivel deveria ser recusada (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, $s$select public.cash_record_movement('withdrawal', 139.50, 'zerar')::text$s$);
  total := total + 1;
  if res like 'ERR:%' then fails := fails || format('sangria exatamente igual ao disponivel deveria passar (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, $s$select public.cash_record_movement('withdrawal', 0.01, 'sem saldo')::text$s$);
  total := total + 1;
  if res not ilike '%insufficient_cash%' then fails := fails || format('sangria com caixa zerado deveria ser recusada (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, $s$select public.cash_record_movement('supply', 5, 'repor')::text$s$);
  total := total + 1;
  if res like 'ERR:%' then fails := fails || format('suprimento depois de zerar deveria passar (%s)', res); end if;

  res := pg_temp._runas('authenticated', u_staff_a, $s$select public.cash_record_movement('supply', 0, 'x')::text$s$);
  total := total + 1;
  if res not ilike '%invalid_amount%' then fails := fails || format('valor zero (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, $s$select public.cash_record_movement('supply', -5, 'x')::text$s$);
  total := total + 1;
  if res not ilike '%invalid_amount%' then fails := fails || format('valor negativo (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, $s$select public.cash_record_movement('supply', 100000000, 'x')::text$s$);
  total := total + 1;
  if res not ilike '%invalid_amount%' then fails := fails || format('valor enorme (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, $s$select public.cash_record_movement('doacao', 5, 'x')::text$s$);
  total := total + 1;
  if res not ilike '%invalid_kind%' then fails := fails || format('tipo invalido (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, $s$select public.cash_record_movement('supply', 5, '   ')::text$s$);
  total := total + 1;
  if res not ilike '%invalid_reason%' then fails := fails || format('motivo vazio (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, format('select public.cash_record_movement(''supply'', 5, %L)::text', repeat('x', 201)));
  total := total + 1;
  if res not ilike '%invalid_reason%' then fails := fails || format('motivo longo (%s)', res); end if;

  -- ---------- 5) isolamento ----------
  res := pg_temp._runas('authenticated', u_owner_b, $s$select public.cash_record_movement('supply', 10, 'x')::text$s$);
  total := total + 1;
  if res not ilike '%cash_not_open%' then fails := fails || format('OWNER B (caixa B fechado) nao deveria alterar nada (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, 'select count(*)::text from public.cash_movements_list()');
  total := total + 1;
  if res <> '0' then fails := fails || format('OWNER B listou movimentos da loja A (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, format('select count(*)::text from public.cash_movements_list(%L)', sid));
  total := total + 1;
  if res <> '0' then fails := fails || format('OWNER B listou sessao da loja A por id (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_stranger, 'select count(*)::text from public.cash_movements_list()');
  total := total + 1;
  if res <> '0' then fails := fails || format('estranho listou movimentos (%s)', res); end if;

  -- ---------- 6) listagem ----------
  res := pg_temp._runas('authenticated', u_staff_a, 'select count(*)::text from public.cash_movements_list()');
  total := total + 1;
  if res <> '4' then fails := fails || format('STAFF deveria ver os 4 movimentos da sessao aberta (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, format('select count(*)::text from public.cash_movements_list(%L)', sid));
  total := total + 1;
  if res <> '0' then fails := fails || format('STAFF nao consulta sessao por id (%s)', res); end if;

  -- ---------- 7) ninguém edita/apaga ----------
  res := pg_temp._runas('authenticated', u_owner_a, 'delete from public.cash_movements returning 1');
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('OWNER apagou movimento (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, 'update public.cash_movements set amount = 1 returning 1');
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('OWNER editou movimento (%s)', res); end if;

  -- ---------- 8) fechamento concilia (esperado = 100 + 50 + 20 - 30,50 - 139,50 + 5 = 5) ----------
  -- Movimentos: +20, -30,50, -139,50 (zerou), +5 => esperado = 100 + 50 + 20 - 170 + 5 = 5,00
  res := pg_temp._runas('authenticated', u_staff_a, 'select expected_cash::text from public.cash_current()');
  total := total + 1;
  if res::numeric <> 5 then fails := fails || format('esperado antes de fechar deveria ser 5,00 (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, 'select (expected_cash::text || '';'' || difference::text) from public.cash_close(4.00, ''fim'')');
  total := total + 1;
  if res <> '5.00;-1.00' then fails := fails || format('fechamento deveria dar esperado 5,00 e diferenca -1,00 (%s)', res); end if;
  total := total + 1;
  if (select expected_cash from public.cash_sessions where id = sid) <> 5 then fails := fails || 'esperado gravado na sessao esta errado'::text; end if;

  res := pg_temp._runas('authenticated', u_staff_a, $s$select public.cash_record_movement('supply', 5, 'tarde')::text$s$);
  total := total + 1;
  if res not ilike '%cash_not_open%' then fails := fails || format('movimento apos o fechamento deveria ser recusado (%s)', res); end if;

  -- sessão fechada: só OWNER lista
  res := pg_temp._runas('authenticated', u_owner_a, format('select count(*)::text from public.cash_movements_list(%L)', sid));
  total := total + 1;
  if res <> '4' then fails := fails || format('OWNER deveria listar os 4 movimentos da sessao fechada (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, format('select count(*)::text from public.cash_movements_list(%L)', sid));
  total := total + 1;
  if res <> '0' then fails := fails || format('STAFF nao deveria listar sessao fechada (%s)', res); end if;

  -- ---------- 9) sem movimentações o cálculo antigo permanece (regressão) ----------
  res := pg_temp._runas('authenticated', u_owner_b, 'select public.cash_open(40)::text');
  insert into public.orders (restaurant_id, order_number, customer_name, customer_phone, fulfillment_type, payment_method, subtotal, total, status, idempotency_key, created_at)
  values (r_b, 1, 'Balcao', '11999990003', 'counter', 'cash', 10, 10, 'received', 'cm-b1', now());
  res := pg_temp._runas('authenticated', u_owner_b, 'select expected_cash::text from public.cash_current()');
  total := total + 1;
  if res::numeric <> 50 then fails := fails || format('sem movimentos o esperado deveria ser abertura + dinheiro = 50 (%s)', res); end if;

  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes', total;
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %', array_length(fails, 1), total, array_to_string(fails, ' ## ');
  end if;
end $$;
