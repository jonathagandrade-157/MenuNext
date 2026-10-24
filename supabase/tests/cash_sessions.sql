-- MenuNext — teste de regressão: sessões de caixa (abrir e fechar o caixa).
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO (local ou branch). Cria usuários e lojas de teste; tudo fica
-- numa transação que SEMPRE termina com `raise exception` (nada persiste).
-- Resultado: a mensagem final do erro é o relatório ("RESULTADO: OK | N verificacoes" ou "FALHOU").
--
-- Regras testadas: tabela fechada (só funções); membros (OWNER e STAFF) abrem/fecham o caixa da PRÓPRIA
-- loja; estranho e visitante não; uma sessão aberta por loja; totais só de vendas de BALCÃO não canceladas
-- da janela da sessão, separados por forma de pagamento; dinheiro esperado = abertura + vendas em dinheiro;
-- diferença de caixa registrada; histórico só para o OWNER; lojas isoladas entre si.

do $$
declare
  u_owner_a uuid := gen_random_uuid();
  u_staff_a uuid := gen_random_uuid();
  u_owner_b uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  r_a uuid; r_b uuid; sid uuid; sid2 uuid;
  rec record; n bigint; err text; s text;
  fails text[] := '{}'; total int := 0;
  seq int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_owner_a, 'owner-a@cs.test', jsonb_build_object('name','Dona A','phone','11999990001','document','12345678062')),
    (u_staff_a, 'staff-a@cs.test', jsonb_build_object('name','Equipe A','phone','11999990002','document','98765432029')),
    (u_owner_b, 'owner-b@cs.test', jsonb_build_object('name','Dono B','phone','11999990003','document','24681357090')),
    (u_stranger,'stranger@cs.test',jsonb_build_object('name','Estranho','phone','11999990005','document','86420975310'));
  update public.profiles set trial_ends_at = now() + interval '30 days' where user_id in (u_owner_a, u_owner_b);

  insert into public.restaurants (name, slug) values ('Loja A', 'cs-a') returning id into r_a;
  insert into public.restaurants (name, slug) values ('Loja B', 'cs-b') returning id into r_b;
  insert into public.restaurant_members (restaurant_id, user_id, role) values
    (r_a, u_owner_a, 'OWNER'), (r_a, u_staff_a, 'STAFF'), (r_b, u_owner_b, 'OWNER');

  -- ---------- 0) catálogo e privilégios ----------
  total := total + 1;
  if not exists (select 1 from pg_class where oid = 'public.cash_sessions'::regclass and relrowsecurity) then
    fails := fails || 'cash_sessions sem RLS'::text;
  end if;
  total := total + 1;
  if has_table_privilege('anon','public.cash_sessions','SELECT') or has_table_privilege('authenticated','public.cash_sessions','SELECT')
     or has_table_privilege('authenticated','public.cash_sessions','INSERT') or has_table_privilege('authenticated','public.cash_sessions','UPDATE')
     or has_table_privilege('authenticated','public.cash_sessions','DELETE') then
    fails := fails || 'cash_sessions tem privilegio direto para anon/authenticated'::text;
  end if;
  total := total + 1;
  if has_function_privilege('anon', 'public.cash_open(numeric)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cash_current()', 'EXECUTE')
     or has_function_privilege('anon', 'public.cash_close(numeric,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cash_history(integer)', 'EXECUTE') then
    fails := fails || 'anon executa funcoes do caixa'::text;
  end if;
  total := total + 1;
  if not (has_function_privilege('authenticated', 'public.cash_open(numeric)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.cash_current()', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.cash_close(numeric,text)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.cash_history(integer)', 'EXECUTE')) then
    fails := fails || 'authenticated nao executa as funcoes do caixa'::text;
  end if;
  total := total + 1;
  if has_function_privilege('authenticated', 'public._cash_totals(uuid,timestamptz,timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public._cash_totals(uuid,timestamptz,timestamptz)', 'EXECUTE') then
    fails := fails || 'funcao interna _cash_totals exposta'::text;
  end if;

  -- ---------- 1) visitante e usuário sem loja ----------
  set local role anon;
  begin
    perform public.cash_open(10);
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%permission denied%' then fails := fails || format('visitante abriu o caixa (%s)', err); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.cash_open(10);
    err := 'ok';
  exception when others then err := sqlerrm; end;
  select count(*) into n from public.cash_current();
  reset role;
  total := total + 1;
  if err not ilike '%not_authorized%' then fails := fails || format('usuario sem loja abriu o caixa (%s)', err); end if;
  total := total + 1;
  if n <> 0 then fails := fails || 'usuario sem loja viu sessao'::text; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform * from public.cash_close(0, null);
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%not_authorized%' then fails := fails || format('usuario sem loja fechou o caixa (%s)', err); end if;

  -- ---------- 2) tabela fechada ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform count(*) from public.cash_sessions;
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%permission denied%' then fails := fails || format('OWNER leu a tabela direto (%s)', err); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.cash_sessions (restaurant_id, opened_by, opening_amount) values (r_a, u_owner_a, 1);
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%permission denied%' then fails := fails || format('OWNER inseriu direto na tabela (%s)', err); end if;

  -- ---------- 3) valores inválidos ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_staff_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.cash_open(-1); err := 'ok'; exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%invalid_amount%' then fails := fails || format('abertura negativa aceita (%s)', err); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_staff_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.cash_open(null); err := 'ok'; exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%invalid_amount%' then fails := fails || format('abertura nula aceita (%s)', err); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_staff_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.cash_open(1000000000); err := 'ok'; exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%invalid_amount%' then fails := fails || format('abertura gigante aceita (%s)', err); end if;

  -- fechar com o caixa fechado
  perform set_config('request.jwt.claims', json_build_object('sub', u_staff_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform * from public.cash_close(10, null); err := 'ok'; exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%cash_not_open%' then fails := fails || format('fechou caixa que nao estava aberto (%s)', err); end if;

  -- ---------- 4) STAFF abre; segunda abertura recusada; loja B é independente ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_staff_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  sid := public.cash_open(100);
  reset role;
  total := total + 1;
  if sid is null or not exists (select 1 from public.cash_sessions where id = sid and restaurant_id = r_a and opened_by = u_staff_a and closed_at is null and opening_amount = 100) then
    fails := fails || 'STAFF nao conseguiu abrir o caixa da propria loja'::text;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.cash_open(50); err := 'ok'; exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%cash_already_open%' then fails := fails || format('segunda sessao aberta na mesma loja (%s)', err); end if;
  total := total + 1;
  select count(*) into n from public.cash_sessions where restaurant_id = r_a and closed_at is null;
  if n <> 1 then fails := fails || format('deveria haver 1 sessao aberta na loja A (n=%s)', n); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  sid2 := public.cash_open(20);
  reset role;
  total := total + 1;
  if not exists (select 1 from public.cash_sessions where id = sid2 and restaurant_id = r_b) then
    fails := fails || 'OWNER B nao abriu o caixa da loja B (ou abriu na loja errada)'::text;
  end if;

  -- ---------- 5) vendas: só balcão, não canceladas, dentro da janela, da própria loja ----------
  -- (as vendas entram com created_at = now(), igual à abertura; a regra é created_at >= abertura)
  insert into public.orders (restaurant_id, order_number, customer_name, customer_phone, fulfillment_type, payment_method, subtotal, total, status, idempotency_key, created_at) values
    (r_a, 1, 'Balcao', '11999990001', 'counter', 'cash', 30, 30, 'received',  'cs-1', now()),
    (r_a, 2, 'Balcao', '11999990001', 'counter', 'pix',  20, 20, 'received',  'cs-2', now()),
    (r_a, 3, 'Balcao', '11999990001', 'counter', 'card', 10, 10, 'picked_up', 'cs-3', now()),
    -- fora da conta: cancelada, antes da abertura, entrega/retirada, outra loja
    (r_a, 4, 'Balcao', '11999990001', 'counter', 'cash', 99, 99, 'cancelled', 'cs-4', now()),
    (r_a, 5, 'Balcao', '11999990001', 'counter', 'cash', 88, 88, 'received',  'cs-5', now() - interval '1 hour'),
    (r_a, 6, 'Cliente','11999990001', 'pickup',  'cash', 77, 77, 'received',  'cs-6', now()),
    (r_b, 1, 'Balcao', '11999990003', 'counter', 'cash', 55, 55, 'received',  'cs-7', now());

  perform set_config('request.jwt.claims', json_build_object('sub', u_staff_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into rec from public.cash_current();
  reset role;
  total := total + 1;
  if rec.session_id is distinct from sid then fails := fails || 'cash_current nao devolveu a sessao aberta da loja A'::text; end if;
  total := total + 1;
  if rec.orders_count <> 3 or rec.total_sales <> 60 then
    fails := fails || format('totais da sessao errados (pedidos=%s, total=%s; esperado 3 e 60)', rec.orders_count, rec.total_sales);
  end if;
  total := total + 1;
  if rec.cash_sales <> 30 or rec.pix_sales <> 20 or rec.card_sales <> 10 then
    fails := fails || format('totais por pagamento errados (dinheiro=%s, pix=%s, cartao=%s)', rec.cash_sales, rec.pix_sales, rec.card_sales);
  end if;
  total := total + 1;
  if rec.opening_amount <> 100 or rec.expected_cash <> 130 then
    fails := fails || format('dinheiro esperado errado (abertura=%s, esperado=%s; esperado 100 e 130)', rec.opening_amount, rec.expected_cash);
  end if;
  total := total + 1;
  if rec.opened_by_name is distinct from 'Equipe A' then fails := fails || format('nome de quem abriu inesperado (%s)', rec.opened_by_name); end if;

  -- OWNER B enxerga só a própria sessão: 1 venda de 55 em dinheiro, esperado 20 + 55
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into rec from public.cash_current();
  reset role;
  total := total + 1;
  if rec.session_id is distinct from sid2 or rec.orders_count <> 1 or rec.expected_cash <> 75 then
    fails := fails || format('sessao da loja B inesperada (pedidos=%s, esperado=%s; esperado 1 e 75)', rec.orders_count, rec.expected_cash);
  end if;

  -- ---------- 6) fechamento por STAFF ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_staff_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into rec from public.cash_close(125, repeat('x', 400));
  reset role;
  total := total + 1;
  if rec.expected_cash <> 130 or rec.counted_cash <> 125 or rec.difference <> -5 then
    fails := fails || format('fechamento: esperado=%s contado=%s diferenca=%s (esperado 130, 125, -5)', rec.expected_cash, rec.counted_cash, rec.difference);
  end if;
  total := total + 1;
  if rec.orders_count <> 3 or rec.total_sales <> 60 or rec.cash_sales <> 30 or rec.pix_sales <> 20 or rec.card_sales <> 10 then
    fails := fails || 'fechamento devolveu totais diferentes do acompanhamento'::text;
  end if;
  total := total + 1;
  select closed_by, char_length(notes), counted_cash, expected_cash into rec from public.cash_sessions where id = sid;
  if rec.closed_by is distinct from u_staff_a or rec.char_length <> 300 or rec.counted_cash <> 125 or rec.expected_cash <> 130 then
    fails := fails || format('sessao fechada gravada errado (fechou=%s, notas=%s)', rec.closed_by, rec.char_length);
  end if;

  -- depois de fechado: sem sessão atual, fechar de novo falha, a loja B segue aberta
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.cash_current();
  begin perform * from public.cash_close(1, null); err := 'ok'; exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if n <> 0 then fails := fails || 'caixa fechado ainda aparece como atual'::text; end if;
  total := total + 1;
  if err not ilike '%cash_not_open%' then fails := fails || format('fechou duas vezes (%s)', err); end if;
  total := total + 1;
  if not exists (select 1 from public.cash_sessions where id = sid2 and closed_at is null) then
    fails := fails || 'fechar a loja A mexeu na loja B'::text;
  end if;

  -- venda DEPOIS do fechamento não entra na sessão fechada
  insert into public.orders (restaurant_id, order_number, customer_name, customer_phone, fulfillment_type, payment_method, subtotal, total, status, idempotency_key, created_at)
  values (r_a, 7, 'Balcao', '11999990001', 'counter', 'cash', 40, 40, 'received', 'cs-8', clock_timestamp() + interval '1 hour');

  -- ---------- 7) histórico: só OWNER, isolado por loja ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into rec from public.cash_history(20);
  select count(*) into n from public.cash_history(20);
  reset role;
  total := total + 1;
  if n <> 1 then fails := fails || format('OWNER A deveria ver 1 sessao no historico (n=%s)', n); end if;
  total := total + 1;
  if rec.session_id is distinct from sid or rec.difference <> -5 or rec.orders_count <> 3 or rec.total_sales <> 60 then
    fails := fails || format('historico errado (diferenca=%s, pedidos=%s, total=%s)', rec.difference, rec.orders_count, rec.total_sales);
  end if;
  total := total + 1;
  if rec.opened_by_name is distinct from 'Equipe A' or rec.closed_by_name is distinct from 'Equipe A' then
    fails := fails || format('nomes no historico inesperados (%s / %s)', rec.opened_by_name, rec.closed_by_name);
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_staff_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.cash_history(20);
  reset role;
  total := total + 1;
  if n <> 0 then fails := fails || format('STAFF leu o historico (n=%s)', n); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*), max(session_id::text) into n, s from public.cash_history(20);
  reset role;
  total := total + 1;
  if n <> 1 or s is distinct from sid2::text then fails := fails || format('historico da loja B vazou ou faltou (n=%s)', n); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.cash_history(20);
  reset role;
  total := total + 1;
  if n <> 0 then fails := fails || format('usuario sem loja leu o historico (n=%s)', n); end if;

  -- ---------- 8) reabrir depois de fechar ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  sid2 := public.cash_open(0);
  reset role;
  total := total + 1;
  if sid2 is null or sid2 = sid or not exists (select 1 from public.cash_sessions where id = sid2 and closed_at is null and opening_amount = 0) then
    fails := fails || 'nao reabriu o caixa depois de fechar'::text;
  end if;

  -- ---------- relatório ----------
  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes', total;
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %', array_length(fails, 1), total, array_to_string(fails, ' ## ');
  end if;
end $$;
