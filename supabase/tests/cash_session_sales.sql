-- MenuNext — teste de regressão: vendas de uma sessão de caixa (cash_session_sales).
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO. Tudo num bloco que SEMPRE termina com `raise exception` (nada persiste).
-- Regras testadas: só vendas de balcão dentro da janela da sessão (antes/depois/entrega ficam fora); canceladas
-- aparecem com status; a soma das não canceladas bate com cash_history; sessão aberta para membros, sessão fechada
-- só para o OWNER; outra loja, estranho e visitante nada.

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
  r_a uuid; r_b uuid; sid uuid; sid_b uuid;
  res text;
  fails text[] := '{}'; total int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_owner_a, 'owner-a@ss.test', jsonb_build_object('name','Dona A','phone','11999990001','document','12345678062')),
    (u_staff_a, 'staff-a@ss.test', jsonb_build_object('name','Equipe A','phone','11999990002','document','98765432029')),
    (u_owner_b, 'owner-b@ss.test', jsonb_build_object('name','Dono B','phone','11999990003','document','24681357090')),
    (u_stranger,'stranger@ss.test',jsonb_build_object('name','Estranho','phone','11999990005','document','86420975310'));
  update public.profiles set trial_ends_at = now() + interval '30 days' where user_id in (u_owner_a, u_owner_b);
  insert into public.restaurants (name, slug) values ('Loja A', 'ss-a') returning id into r_a;
  insert into public.restaurants (name, slug) values ('Loja B', 'ss-b') returning id into r_b;
  insert into public.restaurant_members (restaurant_id, user_id, role) values
    (r_a, u_owner_a, 'OWNER'), (r_a, u_staff_a, 'STAFF'), (r_b, u_owner_b, 'OWNER');

  total := total + 1;
  if has_function_privilege('anon','public.cash_session_sales(uuid)','EXECUTE') or not has_function_privilege('authenticated','public.cash_session_sales(uuid)','EXECUTE') then
    fails := fails || 'privilegios de EXECUTE incorretos'::text;
  end if;

  -- sem sessão aberta: vazio
  res := pg_temp._runas('authenticated', u_staff_a, 'select count(*)::text from public.cash_session_sales()');
  total := total + 1;
  if res <> '0' then fails := fails || format('sem caixa aberto deveria vir vazio (%s)', res); end if;

  sid := pg_temp._runas('authenticated', u_staff_a, 'select public.cash_open(100)::text')::uuid;
  sid_b := pg_temp._runas('authenticated', u_owner_b, 'select public.cash_open(10)::text')::uuid;

  insert into public.orders (restaurant_id, order_number, customer_name, customer_phone, fulfillment_type, payment_method, subtotal, total, status, idempotency_key, created_at) values
    (r_a, 1, 'B', '11999990001', 'counter', 'cash', 30, 30, 'received',  'ss-1', now()),
    (r_a, 2, 'B', '11999990001', 'counter', 'pix',  20, 20, 'received',  'ss-2', now()),
    (r_a, 3, 'B', '11999990001', 'counter', 'card', 10, 10, 'cancelled', 'ss-3', now()),
    (r_a, 4, 'B', '11999990001', 'counter', 'cash', 88, 88, 'received',  'ss-4', now() - interval '1 hour'),
    (r_a, 5, 'E', '11999990001', 'pickup', 'cash', 77, 77, 'received', 'ss-5', now()),
    (r_b, 1, 'B', '11999990003', 'counter', 'cash', 55, 55, 'received',  'ss-b1', now());

  res := pg_temp._runas('authenticated', u_staff_a, 'select count(*)::text from public.cash_session_sales()');
  total := total + 1;
  if res <> '3' then fails := fails || format('sessao aberta deveria listar 3 vendas de balcao na janela (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, 'select string_agg(order_number::text, '','' order by order_number) from public.cash_session_sales()');
  total := total + 1;
  if res <> '1,2,3' then fails := fails || format('pedidos listados incorretos (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, 'select status from public.cash_session_sales() where order_number = 3');
  total := total + 1;
  if res <> 'cancelled' then fails := fails || format('cancelada deveria aparecer com status (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, 'select sum(total)::text from public.cash_session_sales() where status <> ''cancelled''');
  total := total + 1;
  if res::numeric <> 50 then fails := fails || format('soma das nao canceladas deveria ser 50 (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, format('select count(*)::text from public.cash_session_sales(%L)', sid));
  total := total + 1;
  if res <> '0' then fails := fails || format('STAFF nao consulta sessao por id (%s)', res); end if;

  -- isolamento
  res := pg_temp._runas('authenticated', u_owner_b, 'select string_agg(total::text, '','') from public.cash_session_sales()');
  total := total + 1;
  if res <> '55.00' then fails := fails || format('OWNER B so ve a propria venda (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, format('select count(*)::text from public.cash_session_sales(%L)', sid));
  total := total + 1;
  if res <> '0' then fails := fails || format('OWNER B leu sessao da loja A (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_stranger, 'select count(*)::text from public.cash_session_sales()');
  total := total + 1;
  if res <> '0' then fails := fails || format('estranho leu vendas (%s)', res); end if;
  res := pg_temp._runas('anon', null, 'select count(*)::text from public.cash_session_sales()');
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('visitante leu vendas (%s)', res); end if;

  -- fecha e confere com o histórico
  perform pg_temp._runas('authenticated', u_staff_a, 'select closed_at::text from public.cash_close(130, ''ok'')');
  insert into public.orders (restaurant_id, order_number, customer_name, customer_phone, fulfillment_type, payment_method, subtotal, total, status, idempotency_key, created_at)
  values (r_a, 6, 'B', '11999990001', 'counter', 'cash', 40, 40, 'received', 'ss-6', clock_timestamp() + interval '1 hour');

  res := pg_temp._runas('authenticated', u_owner_a, format('select count(*)::text from public.cash_session_sales(%L)', sid));
  total := total + 1;
  if res <> '3' then fails := fails || format('OWNER deveria ver as 3 vendas da sessao fechada, sem a posterior (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select sum(total)::text from public.cash_session_sales(%L) where status <> ''cancelled''', sid));
  total := total + 1;
  if res::numeric <> pg_temp._runas('authenticated', u_owner_a, format('select total_sales::text from public.cash_history(5) where session_id = %L', sid))::numeric then
    fails := fails || 'soma deveria bater com cash_history'::text;
  end if;
  res := pg_temp._runas('authenticated', u_staff_a, 'select count(*)::text from public.cash_session_sales()');
  total := total + 1;
  if res <> '0' then fails := fails || format('sessao fechada nao deve aparecer como atual (%s)', res); end if;

  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes', total;
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %', array_length(fails, 1), total, array_to_string(fails, ' ## ');
  end if;
end $$;
