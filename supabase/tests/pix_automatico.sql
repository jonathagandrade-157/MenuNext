-- MenuNext — teste de regressão: Pix com confirmação automática (migration 20261108010000_pix_automatico.sql).
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO. Tudo num bloco que SEMPRE termina com `raise exception` (nada persiste).
-- Resultado: a mensagem final do erro ("RESULTADO: OK | N verificacoes" ou "FALHOU").
--
-- Regras testadas: token, conta recebedora e segredo do webhook nunca legíveis fora do backend; só o OWNER
-- configura; token novo nasce desligado; trocar de conta apaga o segredo do webhook antigo; funções de backend
-- fechadas para anon/authenticated; reserva da cobrança só para pedido Pix de loja LIGADA, com o total do banco e
-- sem duas tentativas simultâneas; resposta indefinida mantém 'creating' (nunca chave comum); recusa definitiva =
-- 'failed'; registro só com o valor reservado; corrida de registro idempotente; visitante só vê a própria cobrança
-- (copia-e-cola só pendente); aprovação exige valor, moeda BRL, conta recebedora e referência; pago é final;
-- eventos duplicados/fora de ordem; aprovação atrasada depois de expirado; throttle; histórico após remover o token.

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

-- pedido Pix (visitante, entrega) -> public_id
create or replace function pg_temp._pix_order(p_slug text, p_product uuid, p_qty int, p_key text, p_method text default 'pix') returns uuid
language plpgsql as $$
declare v uuid;
begin
  set local role anon;
  select public_id into v from public.create_order(p_slug, 'Cliente', '11988887777', 'delivery', p_method,
    jsonb_build_array(jsonb_build_object('product_id', p_product, 'quantity', p_qty)), p_key,
    '01001000', 'Praca da Se', '100', null, 'Se', 'Sao Paulo', 'SP');
  reset role;
  return v;
end $$;

do $$
declare
  u_owner_a uuid := gen_random_uuid();
  u_staff_a uuid := gen_random_uuid();
  u_owner_b uuid := gen_random_uuid();
  r_a uuid; r_b uuid; cat_a uuid; prod_a uuid;
  slug_a text := 'pix-a';
  pub1 uuid; pub2 uuid; pub3 uuid; pub_cash uuid; ord1 uuid; ch1 uuid; ch2 uuid; ch3 uuid;
  ct text := 'v1:aXZpdml2aXZpdml2:dGFndGFndGFndGFn:Y2lwaGVydGV4dA';
  wh text := 'v1:d2hpdml2aXZpdml2:dGFndGFndGFndGFn:c2VjcmV0';
  qr text := '00020126' || repeat('1', 40);
  res text; rec record;
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
  update public.restaurants set onboarding_completed = true, status = 'active', service_delivery = true, delivery_fee = 0,
         payment_cash = true, payment_pix = true, payment_pix_key = 'pix@pix.test', payment_pix_key_type = 'email' where id = r_a;
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
  if exists (
    select 1 from unnest(array[
      'public.pix_charge_begin_backend(text,uuid,integer)', 'public.pix_charge_register_backend(uuid,text,numeric,text,timestamptz)',
      'public.pix_charge_fail_backend(uuid,text)', 'public.pix_charge_for_sync_backend(text,text,uuid,integer)',
      'public.pix_charge_apply_backend(text,text,numeric,text,text,text)']) f
     where has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
        or not has_function_privilege('service_role', f, 'EXECUTE')) then
    fails := fails || 'funcoes de backend expostas (ou sem service_role)'::text;
  end if;
  total := total + 1;
  if has_function_privilege('anon', 'public.pix_settings_save(uuid,text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.pix_settings_save_webhook_secret(uuid,text)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.get_order_pix_charge(text,uuid)', 'EXECUTE') then
    fails := fails || 'privilegios de pix_settings_*/get_order_pix_charge incorretos'::text;
  end if;
  total := total + 1;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'paid_at') then
    fails := fails || 'orders.paid_at ausente'::text;
  end if;

  -- ---------- 1) configuração ----------
  res := pg_temp._runas('authenticated', u_staff_a, format('select public.pix_settings_save(%L, %L, ''1234'', ''111'')::text', r_a, ct));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('STAFF salvou token (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, format('select public.pix_settings_save(%L, %L, ''1234'', ''111'')::text', r_a, ct));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('OWNER B salvou token na loja A (%s)', res); end if;
  res := pg_temp._runas('anon', null, format('select public.pix_settings_save(%L, %L, ''1234'', ''111'')::text', r_a, ct));
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('visitante chamou pix_settings_save (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.pix_settings_save(%L, ''APP_USR-token-em-claro'', ''1234'', ''111'')::text', r_a));
  total := total + 1;
  if res not ilike '%invalid_token%' then fails := fails || format('token em claro aceito (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.pix_settings_save(%L, %L, ''1234'', ''conta-x'')::text', r_a, ct));
  total := total + 1;
  if res not ilike '%invalid_token%' then fails := fails || format('conta recebedora invalida aceita (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.pix_settings_save_webhook_secret(%L, %L)::text', r_a, wh));
  total := total + 1;
  if res not ilike '%not_configured%' then fails := fails || format('segredo do webhook sem token (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.pix_settings_save(%L, %L, ''1234'', ''111'')::text', r_a, ct));
  total := total + 1;
  if res like 'ERR%' or not exists (select 1 from public.restaurant_pix_settings where restaurant_id = r_a and not enabled and token_hint = '1234' and collector_id = '111') then
    fails := fails || format('OWNER nao salvou (ou nasceu ligado) (%s)', res);
  end if;
  res := pg_temp._runas('authenticated', u_staff_a, format('select public.pix_settings_save_webhook_secret(%L, %L)::text', r_a, wh));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('STAFF salvou segredo do webhook (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.pix_settings_save_webhook_secret(%L, ''segredo-em-claro'')::text', r_a));
  total := total + 1;
  if res not ilike '%invalid_secret%' then fails := fails || format('segredo em claro aceito (%s)', res); end if;
  perform pg_temp._runas('authenticated', u_owner_a, format('select public.pix_settings_save_webhook_secret(%L, %L)::text', r_a, wh));
  res := pg_temp._runas('authenticated', u_staff_a, format('select configured::text || enabled::text || token_hint || webhook_secret_configured::text from public.pix_settings_status(%L)', r_a));
  total := total + 1;
  if res is distinct from 'truefalse1234true' then fails := fails || format('STAFF deveria ver o status (%s)', res); end if;
  -- trocar o token pela MESMA conta mantém o segredo; por OUTRA conta apaga
  perform pg_temp._runas('authenticated', u_owner_a, format('select public.pix_settings_save(%L, %L, ''5678'', ''111'')::text', r_a, ct));
  total := total + 1;
  if (select webhook_secret_ciphertext from public.restaurant_pix_settings where restaurant_id = r_a) is distinct from wh then
    fails := fails || 'trocar o token da mesma conta apagou o segredo do webhook'::text;
  end if;
  perform pg_temp._runas('authenticated', u_owner_a, format('select public.pix_settings_save(%L, %L, ''9999'', ''222'')::text', r_a, ct));
  total := total + 1;
  if (select webhook_secret_ciphertext from public.restaurant_pix_settings where restaurant_id = r_a) is not null then
    fails := fails || 'trocar de conta manteve o segredo do webhook antigo'::text;
  end if;
  perform pg_temp._runas('authenticated', u_owner_a, format('select public.pix_settings_save(%L, %L, ''1234'', ''111'')::text', r_a, ct));
  perform pg_temp._runas('authenticated', u_owner_a, format('select public.pix_settings_save_webhook_secret(%L, %L)::text', r_a, wh));
  res := pg_temp._runas('authenticated', u_owner_b, format('select configured::text from public.pix_settings_status(%L)', r_a));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('OWNER B viu status da loja A (%s)', res); end if;
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

  -- ---------- 2) recurso DESLIGADO: nenhuma reserva ----------
  pub1 := pg_temp._pix_order(slug_a, prod_a, 2, 'pix-1');
  pub_cash := pg_temp._pix_order(slug_a, prod_a, 1, 'pix-cash', 'cash');
  select id into ord1 from public.orders where public_id = pub1;
  res := pg_temp._runas('service_role', null, format('select count(*)::text from public.pix_charge_begin_backend(%L, %L, 8)', slug_a, pub1));
  total := total + 1;
  if res <> '0' or exists (select 1 from public.order_pix_charges where order_id = ord1) then
    fails := fails || format('reserva com o recurso desligado (%s)', res);
  end if;

  -- ---------- 3) ligado: reserva com o total do banco, sem tentativas simultâneas ----------
  perform pg_temp._runas('authenticated', u_owner_a, format('select public.pix_settings_set_enabled(%L, true)::text', r_a));
  res := pg_temp._runas('authenticated', u_owner_a, format('select count(*)::text from public.pix_charge_begin_backend(%L, %L, 8)', slug_a, pub1));
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('OWNER chamou funcao de backend (%s)', res); end if;
  select * into rec from public.pix_charge_begin_backend(slug_a, pub1, 8);
  ch1 := rec.charge_id;
  total := total + 1;
  if ch1 is null or rec.amount <> 80 or rec.token_ciphertext is distinct from ct or rec.collector_id <> '111' or rec.attempts <> 1
     or (select status from public.order_pix_charges where id = ch1) <> 'creating' then
    fails := fails || format('reserva errada (amount=%s attempts=%s)', rec.amount, rec.attempts);
  end if;
  res := pg_temp._runas('service_role', null, format('select count(*)::text from public.pix_charge_begin_backend(%L, %L, 8)', slug_a, pub1));
  total := total + 1;
  if res <> '0' then fails := fails || format('segunda tentativa simultanea liberada (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select count(*)::text from public.pix_charge_begin_backend(%L, %L, 8)', slug_a, pub_cash));
  total := total + 1;
  if res <> '0' then fails := fails || format('reserva para pedido em dinheiro (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select count(*)::text from public.pix_charge_begin_backend(''pix-b'', %L, 0)', pub1));
  total := total + 1;
  if res <> '0' then fails := fails || format('reserva com slug de outra loja (%s)', res); end if;
  -- resposta indefinida do provedor: segue 'creating'; nova tentativa (sem esperar) liberada só depois do intervalo
  res := pg_temp._runas('service_role', null, format('select attempts::text from public.pix_charge_begin_backend(%L, %L, 0)', slug_a, pub1));
  total := total + 1;
  if res is distinct from '2' then fails := fails || format('retomada apos resposta indefinida (%s)', res); end if;
  res := pg_temp._runas('anon', null, format('select status || ''|'' || coalesce(qr_code, ''sem-qr'') from public.get_order_pix_charge(%L, %L)', slug_a, pub1));
  total := total + 1;
  if res is distinct from 'creating|sem-qr' then fails := fails || format('visitante deveria ver "gerando" sem QR (%s)', res); end if;

  -- ---------- 4) registro ----------
  res := pg_temp._runas('service_role', null, format('select public.pix_charge_register_backend(%L, ''5551'', 79.99, %L, now() + interval ''30 min'')', ch1, qr));
  total := total + 1;
  if res not ilike '%amount_mismatch%' then fails := fails || format('registro com valor diferente (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select public.pix_charge_register_backend(%L, ''5551'', 80, %L, now() + interval ''30 min'')', ch1, qr));
  total := total + 1;
  if res is distinct from 'pending' then fails := fails || format('registro valido falhou (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select public.pix_charge_register_backend(%L, ''5551'', 80, %L, now() + interval ''30 min'')', ch1, qr));
  total := total + 1;
  if res is distinct from 'pending' then fails := fails || format('registro repetido do MESMO pagamento deveria ser idempotente (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select public.pix_charge_register_backend(%L, ''5552'', 80, %L, null)', ch1, qr));
  total := total + 1;
  if res not ilike '%charge_not_creating%' then fails := fails || format('segundo pagamento para a mesma cobranca (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select count(*)::text from public.pix_charge_begin_backend(%L, %L, 0)', slug_a, pub1));
  total := total + 1;
  if res <> '0' then fails := fails || format('cobranca pendente reaberta para criacao (%s)', res); end if;

  -- ---------- 5) leitura ----------
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

  -- ---------- 6) throttle e consulta ----------
  res := pg_temp._runas('service_role', null, format('select count(*)::text from public.pix_charge_for_sync_backend(null, %L, %L, 10)', slug_a, pub1));
  total := total + 1;
  if res <> '1' then fails := fails || format('primeira consulta deveria passar (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select count(*)::text from public.pix_charge_for_sync_backend(null, %L, %L, 10)', slug_a, pub1));
  total := total + 1;
  if res <> '0' then fails := fails || format('segunda consulta em menos de 10s deveria ser barrada (%s)', res); end if;
  res := pg_temp._runas('service_role', null, 'select order_public_id::text || restaurant_id::text || collector_id || token_ciphertext || webhook_secret_ciphertext from public.pix_charge_for_sync_backend(''5551'', null, null, 0)');
  total := total + 1;
  if res is distinct from pub1::text || r_a::text || '111' || ct || wh then fails := fails || format('consulta por id do provedor (webhook) (%s)', res); end if;

  -- ---------- 7) aplicar o estado do Mercado Pago ----------
  res := pg_temp._runas('service_role', null, format('select public.pix_charge_apply_backend(''5551'', ''approved'', 79, %L, ''BRL'', ''111'')', pub1));
  total := total + 1;
  if res not ilike '%payment_mismatch%' then fails := fails || format('aprovou com valor diferente (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select public.pix_charge_apply_backend(''5551'', ''approved'', 80, %L, ''BRL'', ''111'')', pub_cash));
  total := total + 1;
  if res not ilike '%payment_mismatch%' then fails := fails || format('aprovou com referencia de outro pedido (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select public.pix_charge_apply_backend(''5551'', ''approved'', 80, %L, ''USD'', ''111'')', pub1));
  total := total + 1;
  if res not ilike '%payment_mismatch%' then fails := fails || format('aprovou em outra moeda (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select public.pix_charge_apply_backend(''5551'', ''approved'', 80, %L, ''BRL'', ''999'')', pub1));
  total := total + 1;
  if res not ilike '%payment_mismatch%' then fails := fails || format('aprovou pago a OUTRA conta (%s)', res); end if;
  res := pg_temp._runas('service_role', null, 'select public.pix_charge_apply_backend(''5551'', ''pago'', 80, null, ''BRL'', ''111'')');
  total := total + 1;
  if res not ilike '%invalid_status%' then fails := fails || format('status desconhecido aceito (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select public.pix_charge_apply_backend(''9999'', ''approved'', 80, %L, ''BRL'', ''111'')', pub1));
  total := total + 1;
  if res not ilike '%charge_not_found%' then fails := fails || format('cobranca inexistente (%s)', res); end if;
  total := total + 1;
  if (select paid_at from public.orders where id = ord1) is not null or (select status from public.order_pix_charges where id = ch1) <> 'pending' then
    fails := fails || 'tentativas invalidas mudaram o pedido'::text;
  end if;
  res := pg_temp._runas('service_role', null, format('select public.pix_charge_apply_backend(''5551'', ''approved'', 80, %L, ''BRL'', ''111'')', pub1));
  total := total + 1;
  if res is distinct from 'approved' or (select paid_at from public.orders where id = ord1) is null
     or (select approved_at from public.order_pix_charges where id = ch1) is null then
    fails := fails || format('aprovacao valida falhou (%s)', res);
  end if;
  -- eventos duplicados e fora de ordem depois de pago
  res := pg_temp._runas('service_role', null, format('select public.pix_charge_apply_backend(''5551'', ''approved'', 80, %L, ''BRL'', ''111'')', pub1))
      || pg_temp._runas('service_role', null, format('select public.pix_charge_apply_backend(''5551'', ''pending'', 80, %L, ''BRL'', ''111'')', pub1))
      || pg_temp._runas('service_role', null, format('select public.pix_charge_apply_backend(''5551'', ''cancelled'', 80, %L, ''BRL'', ''111'')', pub1));
  total := total + 1;
  if res is distinct from 'approvedapprovedapproved' or (select status from public.order_pix_charges where id = ch1) <> 'approved' then
    fails := fails || format('evento duplicado/fora de ordem mudou um pago (%s)', res);
  end if;
  res := pg_temp._runas('anon', null, format('select status || ''|'' || coalesce(qr_code, ''sem-qr'') from public.get_order_pix_charge(%L, %L)', slug_a, pub1));
  total := total + 1;
  if res is distinct from 'approved|sem-qr' then fails := fails || format('pago ainda mostra o copia-e-cola (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select count(*)::text from public.pix_charge_begin_backend(%L, %L, 0)', slug_a, pub1))
      || pg_temp._runas('service_role', null, format('select count(*)::text from public.pix_charge_for_sync_backend(null, %L, %L, 0)', slug_a, pub1))
      || pg_temp._runas('service_role', null, 'select count(*)::text from public.pix_charge_for_sync_backend(''5551'', null, null, 0)');
  total := total + 1;
  if res <> '000' then fails := fails || format('pedido pago ainda reservado/consultado (%s)', res); end if;

  -- ---------- 8) expiração, aprovação atrasada e recusa definitiva ----------
  pub2 := pg_temp._pix_order(slug_a, prod_a, 1, 'pix-2');
  select charge_id into ch2 from public.pix_charge_begin_backend(slug_a, pub2, 8);
  perform public.pix_charge_register_backend(ch2, '5553', 40, qr, now());
  res := pg_temp._runas('service_role', null, 'select public.pix_charge_apply_backend(''5553'', ''expired'', 40, null, ''BRL'', ''111'')')
      || pg_temp._runas('service_role', null, 'select public.pix_charge_apply_backend(''5553'', ''expired'', 40, null, ''BRL'', ''111'')')
      || pg_temp._runas('service_role', null, 'select public.pix_charge_apply_backend(''5553'', ''pending'', 40, null, ''BRL'', ''111'')');
  total := total + 1;
  if res is distinct from 'expiredexpiredexpired' or (select paid_at from public.orders where public_id = pub2) is not null then
    fails := fails || format('expiracao/duplicado/fora de ordem (%s)', res);
  end if;
  res := pg_temp._runas('service_role', null, 'select count(*)::text from public.pix_charge_for_sync_backend(''5553'', null, null, 0)');
  total := total + 1;
  if res <> '1' then fails := fails || format('cobranca expirada deveria aceitar consulta por webhook (aprovacao atrasada) (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select public.pix_charge_apply_backend(''5553'', ''approved'', 40, %L, ''BRL'', ''111'')', pub2));
  total := total + 1;
  if res is distinct from 'approved' or (select paid_at from public.orders where public_id = pub2) is null then
    fails := fails || format('aprovacao atrasada depois de expirado foi perdida (%s)', res);
  end if;
  pub3 := pg_temp._pix_order(slug_a, prod_a, 1, 'pix-3');
  select charge_id into ch3 from public.pix_charge_begin_backend(slug_a, pub3, 8);
  perform public.pix_charge_fail_backend(ch3, 'provider_rejected');
  res := pg_temp._runas('anon', null, format('select status from public.get_order_pix_charge(%L, %L)', slug_a, pub3))
      || pg_temp._runas('service_role', null, format('select count(*)::text from public.pix_charge_begin_backend(%L, %L, 0)', slug_a, pub3));
  total := total + 1;
  if res is distinct from 'failed0' then fails := fails || format('recusa definitiva (%s)', res); end if;
  res := pg_temp._runas('service_role', null, format('select public.pix_charge_register_backend(%L, ''5554'', 40, %L, null)', ch3, qr));
  total := total + 1;
  if res not ilike '%charge_not_creating%' then fails := fails || format('cobranca falha registrada depois (%s)', res); end if;

  -- ---------- 9) token removido no meio da criação ----------
  declare pub4 uuid; ch4 uuid;
  begin
    pub4 := pg_temp._pix_order(slug_a, prod_a, 1, 'pix-4');
    select charge_id into ch4 from public.pix_charge_begin_backend(slug_a, pub4, 0);
    perform pg_temp._runas('authenticated', u_owner_a, format('select public.pix_settings_save(%L, %L, ''7777'', ''333'')::text', r_a, ct));
    perform pg_temp._runas('authenticated', u_owner_a, format('select public.pix_settings_set_enabled(%L, true)::text', r_a));
    res := pg_temp._runas('service_role', null, format('select count(*)::text from public.pix_charge_begin_backend(%L, %L, 0)', slug_a, pub4));
    total := total + 1;
    if res <> '0' or (select status || ':' || failure_reason from public.order_pix_charges where id = ch4) <> 'failed:settings_changed' then
      fails := fails || format('troca de conta no meio da criacao deveria falhar com seguranca (%s)', res);
    end if;
  end;

  -- ---------- 10) remover a configuração preserva o histórico ----------
  res := pg_temp._runas('authenticated', u_staff_a, format('select public.pix_settings_delete(%L)::text', r_a));
  total := total + 1;
  if res not ilike '%not_authorized%' or not exists (select 1 from public.restaurant_pix_settings where restaurant_id = r_a) then
    fails := fails || format('STAFF removeu a configuracao (%s)', res);
  end if;
  perform pg_temp._runas('authenticated', u_owner_a, format('select public.pix_settings_delete(%L)::text', r_a));
  total := total + 1;
  if exists (select 1 from public.restaurant_pix_settings where restaurant_id = r_a) then fails := fails || 'OWNER nao removeu a configuracao'::text; end if;
  total := total + 1;
  if (select count(*) from public.order_pix_charges where restaurant_id = r_a) <> 4
     or (select count(*) from public.orders where restaurant_id = r_a and paid_at is not null) <> 2 then
    fails := fails || 'remover a configuracao apagou o historico'::text;
  end if;

  -- ---------- relatório ----------
  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes', total;
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %', array_length(fails, 1), total, array_to_string(fails, ' ## ');
  end if;
end $$;
