-- MenuNext — teste de regressão: estoque (stock_items, stock_movements, stock_record_movement, stock_set_threshold).
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO (local, branch ou o laboratório descartável do CI). Cria usuários e lojas de
-- teste; tudo acontece num único bloco que SEMPRE termina com `raise exception` (nada persiste).
-- Resultado: a mensagem final do erro é o relatório ("RESULTADO: OK | N verificacoes" ou "FALHOU").
--
-- Regras testadas: só o OWNER da loja do produto movimenta o estoque e define o limite; STAFF e membros de outra loja
-- leem (STAFF) ou não leem (outra loja) mas nunca escrevem; ninguém escreve direto nas tabelas; o saldo nunca fica
-- negativo; cada mudança de saldo gera uma linha no livro com o saldo resultante; o livro soma o saldo; entradas
-- inválidas são recusadas sem alterar nada; visitante não lê nem executa.

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
  r_a uuid; r_b uuid; cat_a uuid; cat_b uuid; prod_a uuid; prod_a2 uuid; prod_b uuid;
  res text; n bigint;
  fails text[] := '{}'; total int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_owner_a, 'owner-a@stock.test', jsonb_build_object('name','Dono A','phone','11999990001','document','12345678062')),
    (u_staff_a, 'staff-a@stock.test', jsonb_build_object('name','Equipe A','phone','11999990002','document','98765432029')),
    (u_owner_b, 'owner-b@stock.test', jsonb_build_object('name','Dono B','phone','11999990003','document','24681357090')),
    (u_stranger,'stranger@stock.test',jsonb_build_object('name','Estranho','phone','11999990005','document','86420975310'));
  update public.profiles set trial_ends_at = now() + interval '30 days' where user_id in (u_owner_a, u_owner_b);

  insert into public.restaurants (name, slug) values ('Loja A', 'stk-a') returning id into r_a;
  insert into public.restaurants (name, slug) values ('Loja B', 'stk-b') returning id into r_b;
  insert into public.restaurant_members (restaurant_id, user_id, role) values
    (r_a, u_owner_a, 'OWNER'), (r_a, u_staff_a, 'STAFF'), (r_b, u_owner_b, 'OWNER');
  update public.restaurants set onboarding_completed = true, status = 'active' where id in (r_a, r_b);
  insert into public.categories (restaurant_id, name, display_order) values (r_a, 'cat-a', 1) returning id into cat_a;
  insert into public.categories (restaurant_id, name, display_order) values (r_b, 'cat-b', 1) returning id into cat_b;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_a, 'prod-a', 10, cat_a, 1) returning id into prod_a;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_a, 'prod-a2', 12, cat_a, 2) returning id into prod_a2;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_b, 'prod-b', 10, cat_b, 1) returning id into prod_b;

  -- ---------- 0) catálogo ----------
  total := total + 1;
  if not exists (select 1 from pg_class where oid = 'public.stock_items'::regclass and relrowsecurity)
     or not exists (select 1 from pg_class where oid = 'public.stock_movements'::regclass and relrowsecurity) then
    fails := fails || 'tabelas de estoque sem RLS'::text;
  end if;
  total := total + 1;
  if has_table_privilege('anon','public.stock_items','SELECT') or has_table_privilege('anon','public.stock_movements','SELECT')
     or has_table_privilege('anon','public.stock_items','INSERT') or has_table_privilege('anon','public.stock_movements','INSERT') then
    fails := fails || 'anon tem privilegio nas tabelas de estoque'::text;
  end if;
  total := total + 1;
  if not has_table_privilege('authenticated','public.stock_items','SELECT')
     or not has_table_privilege('authenticated','public.stock_movements','SELECT')
     or has_table_privilege('authenticated','public.stock_items','INSERT') or has_table_privilege('authenticated','public.stock_items','UPDATE')
     or has_table_privilege('authenticated','public.stock_items','DELETE')
     or has_table_privilege('authenticated','public.stock_movements','INSERT') or has_table_privilege('authenticated','public.stock_movements','UPDATE')
     or has_table_privilege('authenticated','public.stock_movements','DELETE') then
    fails := fails || 'authenticated deveria so ler as tabelas de estoque'::text;
  end if;
  total := total + 1;
  if has_function_privilege('anon', 'public.stock_record_movement(uuid,text,integer,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.stock_set_threshold(uuid,integer)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.stock_record_movement(uuid,text,integer,text)', 'EXECUTE') then
    fails := fails || 'privilegios de EXECUTE das funcoes de estoque incorretos'::text;
  end if;

  -- ---------- 1) OWNER A movimenta ----------
  res := pg_temp._runas('authenticated', u_owner_a, format('select quantity::text from public.stock_record_movement(%L, ''entry'', 10, ''compra'')', prod_a));
  total := total + 1;
  if res is distinct from '10' then fails := fails || format('entrada de 10 deveria dar saldo 10 (%s)', res); end if;

  res := pg_temp._runas('authenticated', u_owner_a, format('select quantity::text from public.stock_record_movement(%L, ''exit'', 3)', prod_a));
  total := total + 1;
  if res is distinct from '7' then fails := fails || format('saida de 3 deveria dar saldo 7 (%s)', res); end if;

  res := pg_temp._runas('authenticated', u_owner_a, format('select quantity::text from public.stock_record_movement(%L, ''loss'', 2, ''queda'')', prod_a));
  total := total + 1;
  if res is distinct from '5' then fails := fails || format('perda de 2 deveria dar saldo 5 (%s)', res); end if;

  res := pg_temp._runas('authenticated', u_owner_a, format('select quantity::text from public.stock_record_movement(%L, ''adjustment'', 20, ''contagem'')', prod_a));
  total := total + 1;
  if res is distinct from '20' then fails := fails || format('ajuste para 20 deveria dar saldo 20 (%s)', res); end if;

  total := total + 1;
  if (select count(*) from public.stock_movements where product_id = prod_a) <> 4 then fails := fails || 'o livro deveria ter 4 linhas'::text; end if;
  total := total + 1;
  if (select sum(delta) from public.stock_movements where product_id = prod_a) is distinct from 20
     or (select quantity from public.stock_items where product_id = prod_a) is distinct from 20 then
    fails := fails || 'a soma do livro deveria igualar o saldo'::text;
  end if;
  total := total + 1;
  if not exists (select 1 from public.stock_movements where product_id = prod_a and kind = 'adjustment' and delta = 15 and balance_after = 20 and created_by = u_owner_a and note = 'contagem') then
    fails := fails || 'o ajuste deveria registrar delta 15, saldo 20, autor e nota'::text;
  end if;
  total := total + 1;
  if not exists (select 1 from public.stock_movements where product_id = prod_a and kind = 'loss' and delta = -2 and balance_after = 5) then
    fails := fails || 'a perda deveria registrar delta -2 e saldo 5'::text;
  end if;

  -- ---------- 2) entradas inválidas não alteram nada ----------
  res := pg_temp._runas('authenticated', u_owner_a, format('select quantity::text from public.stock_record_movement(%L, ''exit'', 100)', prod_a));
  total := total + 1;
  if res not ilike '%insufficient_stock%' then fails := fails || format('saida maior que o saldo deveria ser recusada (%s)', res); end if;

  res := pg_temp._runas('authenticated', u_owner_a, format('select quantity::text from public.stock_record_movement(%L, ''entry'', 0)', prod_a));
  total := total + 1;
  if res not ilike '%invalid_quantity%' then fails := fails || format('entrada zero deveria ser recusada (%s)', res); end if;

  res := pg_temp._runas('authenticated', u_owner_a, format('select quantity::text from public.stock_record_movement(%L, ''entry'', -5)', prod_a));
  total := total + 1;
  if res not ilike '%invalid_quantity%' then fails := fails || format('quantidade negativa deveria ser recusada (%s)', res); end if;

  res := pg_temp._runas('authenticated', u_owner_a, format('select quantity::text from public.stock_record_movement(%L, ''entry'', 2000000)', prod_a));
  total := total + 1;
  if res not ilike '%invalid_quantity%' then fails := fails || format('quantidade enorme deveria ser recusada (%s)', res); end if;

  res := pg_temp._runas('authenticated', u_owner_a, format('select quantity::text from public.stock_record_movement(%L, ''sumiço'', 1)', prod_a));
  total := total + 1;
  if res not ilike '%invalid_kind%' then fails := fails || format('tipo desconhecido deveria ser recusado (%s)', res); end if;

  res := pg_temp._runas('authenticated', u_owner_a, format('select quantity::text from public.stock_record_movement(%L, ''adjustment'', 20)', prod_a));
  total := total + 1;
  if res not ilike '%no_change%' then fails := fails || format('ajuste para o mesmo saldo deveria ser recusado (%s)', res); end if;

  res := pg_temp._runas('authenticated', u_owner_a, format('select quantity::text from public.stock_record_movement(%L, ''entry'', 1, %L)', prod_a, repeat('x', 201)));
  total := total + 1;
  if res not ilike '%note_too_long%' then fails := fails || format('nota longa demais deveria ser recusada (%s)', res); end if;

  total := total + 1;
  if (select quantity from public.stock_items where product_id = prod_a) is distinct from 20
     or (select count(*) from public.stock_movements where product_id = prod_a) <> 4 then
    fails := fails || 'entradas invalidas alteraram saldo ou livro'::text;
  end if;

  -- saldo zero é permitido (e produto sem linha é criado na primeira movimentação)
  res := pg_temp._runas('authenticated', u_owner_a, format('select quantity::text from public.stock_record_movement(%L, ''entry'', 4)', prod_a2));
  total := total + 1;
  if res is distinct from '4' then fails := fails || format('primeira movimentacao deveria criar o saldo (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select quantity::text from public.stock_record_movement(%L, ''exit'', 4)', prod_a2));
  total := total + 1;
  if res is distinct from '0' then fails := fails || format('zerar o saldo deveria ser permitido (%s)', res); end if;

  -- ---------- 3) limite do alerta ----------
  res := pg_temp._runas('authenticated', u_owner_a, format('select low_threshold::text from public.stock_set_threshold(%L, 25)', prod_a));
  total := total + 1;
  if res is distinct from '25' then fails := fails || format('limite 25 nao gravado (%s)', res); end if;
  total := total + 1;
  if (select quantity from public.stock_items where product_id = prod_a) is distinct from 20 then fails := fails || 'definir o limite alterou o saldo'::text; end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select low_threshold::text from public.stock_set_threshold(%L, -1)', prod_a));
  total := total + 1;
  if res not ilike '%invalid_threshold%' then fails := fails || format('limite negativo deveria ser recusado (%s)', res); end if;
  -- limite em produto ainda sem saldo cria a linha com saldo 0
  res := pg_temp._runas('authenticated', u_owner_a, format('select quantity::text from public.stock_set_threshold(%L, 3)', (select id from public.products where restaurant_id = r_a and name = 'prod-a2')));
  total := total + 1;
  if res is distinct from '0' then fails := fails || format('limite sem saldo previo deveria criar linha com saldo 0 (%s)', res); end if;

  -- ---------- 4) leitura ----------
  res := pg_temp._runas('authenticated', u_staff_a, 'select count(*)::text from public.stock_items');
  total := total + 1;
  if res is distinct from '2' then fails := fails || format('STAFF deveria ler os 2 saldos da propria loja (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, 'select count(*)::text from public.stock_movements');
  total := total + 1;
  if res is distinct from '6' then fails := fails || format('STAFF deveria ler as 6 movimentacoes da propria loja (%s)', res); end if;

  res := pg_temp._runas('authenticated', u_owner_b, format('select count(*)::text from public.stock_items where restaurant_id = %L', r_a));
  total := total + 1;
  if res is distinct from '0' then fails := fails || format('OWNER B leu saldo da loja A (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, format('select count(*)::text from public.stock_movements where restaurant_id = %L', r_a));
  total := total + 1;
  if res is distinct from '0' then fails := fails || format('OWNER B leu livro da loja A (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_stranger, 'select count(*)::text from public.stock_items');
  total := total + 1;
  if res is distinct from '0' then fails := fails || format('usuario sem loja leu estoque (%s)', res); end if;
  res := pg_temp._runas('anon', null, 'select count(*)::text from public.stock_items');
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('visitante conseguiu ler stock_items (%s)', res); end if;
  res := pg_temp._runas('anon', null, 'select count(*)::text from public.stock_movements');
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('visitante conseguiu ler stock_movements (%s)', res); end if;

  -- ---------- 5) quem NÃO movimenta ----------
  res := pg_temp._runas('authenticated', u_staff_a, format('select quantity::text from public.stock_record_movement(%L, ''entry'', 5)', prod_a));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('STAFF movimentou estoque (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, format('select low_threshold::text from public.stock_set_threshold(%L, 1)', prod_a));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('STAFF alterou o limite (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, format('select quantity::text from public.stock_record_movement(%L, ''entry'', 5)', prod_a));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('OWNER B movimentou produto da loja A (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, format('select low_threshold::text from public.stock_set_threshold(%L, 1)', prod_a));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('OWNER B alterou limite da loja A (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_stranger, format('select quantity::text from public.stock_record_movement(%L, ''entry'', 5)', prod_a));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('usuario sem loja movimentou estoque (%s)', res); end if;
  res := pg_temp._runas('anon', null, format('select quantity::text from public.stock_record_movement(%L, ''entry'', 5)', prod_a));
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('visitante executou stock_record_movement (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select quantity::text from public.stock_record_movement(%L, ''entry'', 5)', gen_random_uuid()));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('produto inexistente deveria ser recusado (%s)', res); end if;
  total := total + 1;
  if (select quantity from public.stock_items where product_id = prod_a) is distinct from 20
     or (select count(*) from public.stock_items where restaurant_id = r_b) <> 0 then
    fails := fails || 'tentativas nao autorizadas alteraram o estoque'::text;
  end if;

  -- ---------- 6) ninguém escreve direto ----------
  res := pg_temp._runas('authenticated', u_owner_a, format('update public.stock_items set quantity = 999 where product_id = %L returning ''ok''', prod_a));
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('OWNER atualizou stock_items direto (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('insert into public.stock_items (product_id, restaurant_id, quantity) values (%L, %L, 5) returning ''ok''', prod_b, r_a));
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('OWNER inseriu em stock_items direto (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('insert into public.stock_movements (restaurant_id, product_id, kind, delta, balance_after) values (%L, %L, ''entry'', 1, 21) returning ''ok''', r_a, prod_a));
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('OWNER inseriu no livro direto (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, 'delete from public.stock_movements returning ''ok''');
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('OWNER apagou linhas do livro (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, 'update public.stock_movements set delta = 99 returning ''ok''');
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('OWNER editou o livro (%s)', res); end if;

  -- ---------- 7) isolamento: a loja B tem o próprio estoque ----------
  res := pg_temp._runas('authenticated', u_owner_b, format('select quantity::text from public.stock_record_movement(%L, ''entry'', 7)', prod_b));
  total := total + 1;
  if res is distinct from '7' then fails := fails || format('OWNER B nao movimentou o proprio produto (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select count(*)::text from public.stock_items where restaurant_id = %L', r_b));
  total := total + 1;
  if res is distinct from '0' then fails := fails || format('OWNER A leu estoque da loja B (%s)', res); end if;
  total := total + 1;
  if (select quantity from public.stock_items where product_id = prod_a) is distinct from 20 then fails := fails || 'movimento da loja B alterou a loja A'::text; end if;

  -- ---------- 8) apagar o produto apaga estoque e livro ----------
  delete from public.products where id = prod_a;
  total := total + 1;
  if exists (select 1 from public.stock_items where product_id = prod_a) or exists (select 1 from public.stock_movements where product_id = prod_a) then
    fails := fails || 'estoque/livro sobraram depois de apagar o produto'::text;
  end if;

  -- ---------- relatório ----------
  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes', total;
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %', array_length(fails, 1), total, array_to_string(fails, ' ## ');
  end if;
end $$;
