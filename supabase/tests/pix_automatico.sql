-- MenuNext — teste de regressão: Pix com confirmação automática (migration 20261108010000_pix_automatico.sql).
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO. Tudo num bloco que SEMPRE termina com `raise exception` (nada persiste).
-- Resultado: a mensagem final do erro ("RESULTADO: OK | N verificacoes" ou "FALHOU").
--
-- Regras testadas: ninguém além do backend lê o token cifrado (nem o OWNER, nem a equipe, nem o visitante);
-- só o OWNER configura, liga e remove; token novo nasce desligado; a equipe vê o status sem o token; outra loja
-- nada; funções de backend fechadas para anon/authenticated; contexto só para pedido Pix de loja LIGADA; valor da
-- cobrança tem de ser o total; uma cobrança por pedido; visitante vê a cobrança do próprio pedido (e só o
-- copia-e-cola enquanto pendente); aprovação só com valor e referência iguais; pago é final e marca orders.paid_at;
-- throttle da consulta; pedido sem Pix automático continua igual.

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
  perform set_config('request.jwt.claims', '', true);
  return v_res;
end $$;

do $$
declare
  u_owner_a uuid := gen_random_uuid();
  u_staff_a uuid := gen_random_uuid();
  u_owner_b uuid := gen_random_uuid();
  r_a uuid; r_b uuid; cat_a uuid; prod_a uuid;
  slug_a text := 'pix-a';
  pub1 uuid; pub2 uuid; pub_cash uuid; ord1 uuid; ord2 uuid; ch1 uuid;
  ct text := 'v1:aXZpdml2aXZpdml2:dGFndGFndGFndGFn:Y2lwaGVydGV4dA==';
  res text; n bigint; rec record;
  fails text[] := '{}'; total int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_owner_a, 'owner-a@pix.test', jsonb_build_object('name','Dona A','phone','11999990001','document','12345678062')),
    (u_staff_a, 'staff-a@pix.test', jsonb_build_object('name','Equipe A','phone','11999990002','document','98765432029')),
    (u_owner_b, 'owner-b@pix.test', jsonb_build_object('name','Dono B','phone','11999990003','document','24681357090'));
  update public.profiles set trial_ends_at = now() + interval '30 days' where user_id in (u_owner_a, u_owner_b);
  insert into public.restaurants (name, slug) values ('Loja A', slug_a) returning id into r_a;
  insert into public.restaurants (name, slug) values ('Loja B', 'pix-b') returning id into r_b;
  insert into public.restaurant_members (restaurant_id, user_id, role) values
    (r_a, u_owner_a, 'OWNER'), (r_a, u_staff_a, 'STAFF'), (r_b, u_owner_b, 'OWNER');
  update public.restaurants set onboarding_completed = true, status = 'active', service_pickup = true, payment_cash = true,
         payment_pix = true, payment_pix_key = 'pix@pix.test', payment_pix_key_type = 'email' where id = r_a;
  delete from public.business_hours where restaurant_id = r_a;
  insert into public.business_hours (restaurant_id, day_of_week, opens_at, closes_at, period_order)
    select r_a, d, '00:00', '23:59:59', 1 from generate_series(0, 6) d;
  insert into public.categories (restaurant_id, name, display_order) values (r_a, 'c', 1) returning id into cat_a;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_a, 'Pizza', 40, cat_a, 1) returning id into prod_a;

  -- ---------- 0) catálogo e privilégios ----------
  total := total + 1;
  if has_table_privilege('anon', 'public.restaurant_pix_settings', 'SELECT') or has_table_privilege('authenticated', 'public.restaurant_pix_settings', 'SELECT')
     or has_table_privilege('authenticated', 'public.restaurant_pix_settings', 'INSERT') or has_table_privilege('authenticated', 'public.restaurant_pix_settings', 'UPDATE') then
    fails := fails || 'restaurant_pix_settings acessivel por anon/authenticated'::text;
  end if;
  total := total + 1;
  if has_table_privilege('anon', 'public.order_pix_charges', 'SELECT') or has_table_privilege('authenticated', 'public.order_pix_charges', 'INSERT')
     or has_table_privilege('authenticated', 'public.order_pix_charges', 'UPDATE') or not has_table_privilege('authenticated', 'public.order_pix_charges', 'SELECT') then
    fails := fails || 'privilegios de order_pix_charges incorretos'::text;
  end if;
  total := total + 1;
  if has_function_privilege('anon', 'public.pix_charge_apply_backend(text,text,numeric,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.pix_charge_apply_backend(text,text,numeric,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.pix_charge_register_backend(uuid,text,numeric,text,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.pix_charge_context_backend(text,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.pix_charge_for_sync_backend(text,text,uuid,integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.pix_charge_apply_backend(text,text,numeric,text)', 'EXECUTE') then
    fails := fails || 'funcoes de backend expostas (ou sem service_role)'::text;
  end if;
  total := total + 1;
  if has_function_privilege('anon', 'public.pix_settings_save(uuid,text,text)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.get_order_pix_charge(text,uuid)', 'EXECUTE') then
    fails := fails || 'privilegios de pix_settings_save/get_order_pix_charge incorretos'::text;
  end if;
  total := total + 1;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'paid_at') then
    fails := fails || 'orders.paid_at ausente'::text;
  end if;

  -- ---------- 1) configuração ----------
  res := pg_temp._runas('authenticated', u_staff_a, format('select public.pix_settings_save(%L, %L, ''1234'')::text', r_a, ct));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('STAFF salvou token (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, format('select public.pix_settings_save(%L, %L, ''1234'')::text', r_a, ct));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('OWNER B salvou token na loja A (%s)', res); end if;
  res := pg_temp._runas('anon', null, format('select public.pix_settings_save(%L, %L, ''1234'')::text', r_a, ct));
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('visitante chamou pix_settings_save (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.pix_settings_save(%L, ''token-em-claro-APP_USR-123'', ''1234'')::text', r_a));
  total := total + 1;
  if res not ilike '%invalid_token%' then fails := fails || format('token em claro aceito (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.pix_settings_save(%L, %L, ''1234'')::text', r_a, ct));
  total := total + 1;
  if res like 'ERR%' or not exists (select 1 from public.restaurant_pix_settings where restaurant_id = r_a and not enabled and token_hint = '1234') then
    fails := fails || format('OWNER nao salvou (ou nasceu ligado) (%s)', res);
  end if;
  res := pg_temp._runas('authenticated', u_staff_a, format('select configured::text || enabled::text || token_hint from public.pix_settings_status(%L)', r_a));
  total := total + 1;
  if res is distinct from 'truefalse1234' then fails := fails || format('STAFF deveria ver o status (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, format('select configured::text from public.pix_settings_status(%L)', r_a));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('OWNER B viu status da loja A (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select configured::text from public.pix_settings_status(%L)', r_b));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('OWNER A viu status da loja B (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, format('select configured::text from public.pix_settings_status(%L)', r_b));
  total := total + 1;
  if res is distinct from 'false' then fails := fails || format('loja sem configuracao deveria dar configured=false (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, 'select token_ciphertext from public.restaurant_pix_settings');
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('OWNER leu o token cifrado direto (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, format('select public.pix_settings_set_enabled(%L, true)::text', r_a));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('STAFF ligou o Pix automatico (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, format('select public.pix_settings_set_enabled(%L, true)::text', r_b));
  total := total + 1;
  if res not ilike '%not_configured%' then fails := fails || format('ligar sem token deveria falhar (%s)', res); end if;

  -- ---------- 2) pedido Pix com o recurso DESLIGADO: sem contexto ----------
  set local role anon;
  select public_id into pub1 from public.create_order(slug_a, 'Cliente', '11988887777', 'pickup', 'pix',
    jsonb_build_array(jsonb_build_object('product_id', prod_a, 'quantity', 2)), 'pix-1');
  select public_id into pub_cash from public.create_order(slug_a, 'Cliente', '11988887777', 'pickup', 'cash',
    jsonb_build_array(jsonb_build_object('product_id', prod_a, 'quantity', 1)), 'pix-cash');
  reset role;
  select id into ord1 from public.orders where public_id = pub1;
  res := pg_temp._runas('service_role', null, format('select count(*)::text from public.pix_charge_context_backend(%L, %L)', slug_a, pub1));
  total := total + 1;
  if res <> '0' then fails := fails || format('contexto com o recurso desligado (%s)', res); end if;

  -- ---------- 3) ligado: contexto, registro ----------
  perform pg_temp._runas('authenticated', u_owner_a, format('select public.pix_settings_set_enabled(%L, true)::text', r_a));
  select * into rec from public.pix_charge_context_backend(slug_a, pub1);
  total := total + 1;
  if rec.order_id is distinct from ord1 or rec.total <> 80 or rec.token_ciphertext is distinct from ct or rec.has_charge then
    fails := fails || format('contexto errado (total=%s)', rec.total);
  end if;
  res := pg_temp._runas('service_role', null, format('select count(*)::text from public.pix_charge_context_backend(%L, %L)', slug_a, pub_cash));
  total := total + 1;
  if res <> '0' then fails := fails || format('contexto para pedido em dinheiro (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select count(*)::text from public.pix_charge_context_backend(''pix-b'', %L)', pub1));
  total := total + 1;
  if res <> '0' then fails := fails || format('contexto com slug de outra loja (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select count(*)::text from public.pix_charge_context_backend(%L, %L)', slug_a, pub1));
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('OWNER chamou contexto de backend (%s)', res); end if;

  res := pg_temp._runas('service_role', null, format('select public.pix_charge_register_backend(%L, ''111'', 79.99, %L, now() + interval ''30 min'')::text', ord1, repeat('0', 40)));
  total := total + 1;
  if res not ilike '%amount_mismatch%' then fails := fails || format('cobranca com valor diferente do total (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select public.pix_charge_register_backend(%L, ''111'', 80, %L, now() + interval ''30 min'')::text',
    (select id from public.orders where public_id = pub_cash), repeat('0', 40)));
  total := total + 1;
  if res not ilike '%order_not_pix%' then fails := fails || format('cobranca para pedido em dinheiro (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select public.pix_charge_register_backend(%L, ''111'', 80, %L, now() + interval ''30 min'')::text', ord1, '00020126' || repeat('1', 40)));
  ch1 := case when res like 'ERR%' then null else res::uuid end;
  total := total + 1;
  if ch1 is null then fails := fails || format('registro valido falhou (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select public.pix_charge_register_backend(%L, ''222'', 80, %L, null)::text', ord1, repeat('0', 40)));
  total := total + 1;
  if res not ilike '%charge_exists%' then fails := fails || format('segunda cobranca para o mesmo pedido (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select has_charge::text from public.pix_charge_context_backend(%L, %L)', slug_a, pub1));
  total := total + 1;
  if res is distinct from 'true' then fails := fails || format('contexto deveria indicar cobranca existente (%s)', res); end if;

  -- ---------- 4) leitura ----------
  res := pg_temp._runas('anon', null, format('select status || ''|'' || left(qr_code, 8) || ''|'' || amount::text from public.get_order_pix_charge(%L, %L)', slug_a, pub1));
  total := total + 1;
  if res is distinct from 'pending|00020126|80.00' then fails := fails || format('visitante nao viu a cobranca do proprio pedido (%s)', res); end if;
  res := pg_temp._runas('anon', null, format('select count(*)::text from public.get_order_pix_charge(''pix-b'', %L)', pub1));
  total := total + 1;
  if res <> '0' then fails := fails || format('cobranca visivel com slug de outra loja (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, 'select count(*)::text from public.order_pix_charges');
  total := total + 1;
  if res <> '1' then fails := fails || format('STAFF deveria ver a cobranca da loja (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, 'select count(*)::text from public.order_pix_charges');
  total := total + 1;
  if res <> '0' then fails := fails || format('OWNER B viu cobranca da loja A (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('update public.order_pix_charges set status = ''approved'' where id = %L returning 1', ch1));
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('OWNER aprovou a cobranca direto (%s)', res); end if;
  res := pg_temp._runas('anon', null, format('select public.pix_charge_apply_backend(''111'', ''approved'', 80, %L)', pub1));
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('visitante aprovou a cobranca (%s)', res); end if;

  -- ---------- 5) throttle da consulta ----------
  res := pg_temp._runas('service_role', null, format('select count(*)::text from public.pix_charge_for_sync_backend(null, %L, %L, 10)', slug_a, pub1));
  total := total + 1;
  if res <> '1' then fails := fails || format('primeira consulta deveria passar (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select count(*)::text from public.pix_charge_for_sync_backend(null, %L, %L, 10)', slug_a, pub1));
  total := total + 1;
  if res <> '0' then fails := fails || format('segunda consulta em menos de 10s deveria ser barrada (%s)', res); end if;
  res := pg_temp._runas('service_role', null, 'select order_public_id::text || restaurant_id::text || token_ciphertext from public.pix_charge_for_sync_backend(''111'', null, null, 0)');
  total := total + 1;
  if res is distinct from pub1::text || r_a::text || ct then fails := fails || format('consulta por id do provedor (webhook) (%s)', res); end if;

  -- ---------- 6) aplicar o estado do Mercado Pago ----------
  res := pg_temp._runas('service_role', null, format('select public.pix_charge_apply_backend(''111'', ''approved'', 79, %L)', pub1));
  total := total + 1;
  if res not ilike '%payment_mismatch%' then fails := fails || format('aprovou com valor diferente (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select public.pix_charge_apply_backend(''111'', ''approved'', 80, %L)', pub_cash));
  total := total + 1;
  if res not ilike '%payment_mismatch%' then fails := fails || format('aprovou com referencia de outro pedido (%s)', res); end if;
  res := pg_temp._runas('service_role', null, 'select public.pix_charge_apply_backend(''111'', ''pago'', 80, null)');
  total := total + 1;
  if res not ilike '%invalid_status%' then fails := fails || format('status desconhecido aceito (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select public.pix_charge_apply_backend(''999'', ''approved'', 80, %L)', pub1));
  total := total + 1;
  if res not ilike '%charge_not_found%' then fails := fails || format('cobranca inexistente (%s)', res); end if;
  total := total + 1;
  if (select paid_at from public.orders where id = ord1) is not null or (select status from public.order_pix_charges where id = ch1) <> 'pending' then
    fails := fails || 'tentativas invalidas mudaram o pedido'::text;
  end if;
  res := pg_temp._runas('service_role', null, format('select public.pix_charge_apply_backend(''111'', ''approved'', 80, %L)', pub1));
  total := total + 1;
  if res is distinct from 'approved' or (select paid_at from public.orders where id = ord1) is null
     or (select approved_at from public.order_pix_charges where id = ch1) is null then
    fails := fails || format('aprovacao valida falhou (%s)', res);
  end if;
  res := pg_temp._runas('service_role', null, format('select public.pix_charge_apply_backend(''111'', ''cancelled'', 80, %L)', pub1));
  total := total + 1;
  if res is distinct from 'approved' or (select status from public.order_pix_charges where id = ch1) <> 'approved' then
    fails := fails || format('pago foi rebaixado (%s)', res);
  end if;
  res := pg_temp._runas('anon', null, format('select status || ''|'' || coalesce(qr_code, ''sem-qr'') from public.get_order_pix_charge(%L, %L)', slug_a, pub1));
  total := total + 1;
  if res is distinct from 'approved|sem-qr' then fails := fails || format('pago ainda mostra o copia-e-cola (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select count(*)::text from public.pix_charge_context_backend(%L, %L)', slug_a, pub1));
  total := total + 1;
  if res <> '0' then fails := fails || format('pedido pago ainda gera contexto de cobranca (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select count(*)::text from public.pix_charge_for_sync_backend(null, %L, %L, 0)', slug_a, pub1));
  total := total + 1;
  if res <> '0' then fails := fails || format('cobranca paga ainda e consultada (%s)', res); end if;

  -- ---------- 7) expiração e cancelamento de outra cobrança ----------
  set local role anon;
  select public_id into pub2 from public.create_order(slug_a, 'Cliente', '11988887777', 'pickup', 'pix',
    jsonb_build_array(jsonb_build_object('product_id', prod_a, 'quantity', 1)), 'pix-2');
  reset role;
  select id into ord2 from public.orders where public_id = pub2;
  perform pg_temp._runas('service_role', null, format('select public.pix_charge_register_backend(%L, ''333'', 40, %L, now())::text', ord2, repeat('0', 40)));
  res := pg_temp._runas('service_role', null, 'select public.pix_charge_apply_backend(''333'', ''expired'', 40, null)');
  total := total + 1;
  if res is distinct from 'expired' or (select paid_at from public.orders where id = ord2) is not null then
    fails := fails || format('expiracao (%s)', res);
  end if;
  res := pg_temp._runas('service_role', null, format('select public.pix_charge_apply_backend(''333'', ''approved'', 40, %L)', pub2));
  total := total + 1;
  if res is distinct from 'expired' or (select paid_at from public.orders where id = ord2) is not null then
    fails := fails || format('cobranca expirada foi aprovada depois (%s)', res);
  end if;

  -- ---------- 8) remover a configuração ----------
  res := pg_temp._runas('authenticated', u_staff_a, format('select public.pix_settings_delete(%L)::text', r_a));
  total := total + 1;
  if res not ilike '%not_authorized%' or not exists (select 1 from public.restaurant_pix_settings where restaurant_id = r_a) then
    fails := fails || format('STAFF removeu a configuracao (%s)', res);
  end if;
  perform pg_temp._runas('authenticated', u_owner_a, format('select public.pix_settings_delete(%L)::text', r_a));
  total := total + 1;
  if exists (select 1 from public.restaurant_pix_settings where restaurant_id = r_a) then fails := fails || 'OWNER nao removeu a configuracao'::text; end if;
  total := total + 1;
  if (select count(*) from public.order_pix_charges where restaurant_id = r_a) <> 2 then
    fails := fails || 'remover a configuracao apagou o historico de cobrancas'::text;
  end if;

  -- ---------- relatório ----------
  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes', total;
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %', array_length(fails, 1), total, array_to_string(fails, ' ## ');
  end if;
end $$;
