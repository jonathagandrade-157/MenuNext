-- MenuNext — teste de regressão: variantes no PEDIDO (migration 20261108000000_order_item_variants.sql).
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO. Tudo num bloco que SEMPRE termina com `raise exception` (nada persiste).
-- Resultado: a mensagem final do erro ("RESULTADO: OK | N verificacoes" ou "FALHOU").
--
-- Regras testadas: leitura pública das variantes só de loja publicada (visitante e estranho não veem loja oculta);
-- produto SEM variantes: pedido idêntico ao de antes; produto COM variantes exige a escolha; preço vem da variante
-- (do banco, nunca do JSON do navegador); variante desligada, de outro produto, de outra loja ou inexistente é
-- recusada; id malformado = invalid_items; adicional soma sobre a variante; cupom incide sobre o subtotal da
-- variante; PDV (counter) usa a mesma regra; idempotência; apagar a variante preserva o histórico do item.

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

-- pedido de retirada pelo visitante; devolve 'ok' ou 'ERR: <codigo>'
create or replace function pg_temp._order(p_slug text, p_items jsonb, p_key text, p_coupon text default null) returns text
language plpgsql as $$
begin
  return pg_temp._runas('anon', null, format(
    'select public_id::text from public.create_order(%L, ''Cliente'', ''11988887777'', ''pickup'', ''cash'', %L::jsonb, %L, null, null, null, null, null, null, null, null, null, null, null, %L)',
    p_slug, p_items::text, p_key, p_coupon));
end $$;

do $$
declare
  u_owner_a uuid := gen_random_uuid();
  u_staff_a uuid := gen_random_uuid();
  u_owner_b uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  r_a uuid; r_b uuid; cat_a uuid; cat_b uuid; pizza uuid; suco uuid; pb uuid;
  v_p uuid; v_m uuid; v_g uuid; v_b uuid; grp uuid; borda uuid;
  slug_a text := 'oiv-a';
  res text; o record; it record; n bigint;
  fails text[] := '{}'; total int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_owner_a, 'owner-a@oiv.test', jsonb_build_object('name','Dona A','phone','11999990001','document','12345678062')),
    (u_staff_a, 'staff-a@oiv.test', jsonb_build_object('name','Equipe A','phone','11999990002','document','98765432029')),
    (u_owner_b, 'owner-b@oiv.test', jsonb_build_object('name','Dono B','phone','11999990003','document','24681357090')),
    (u_stranger,'stranger@oiv.test',jsonb_build_object('name','Estranho','phone','11999990005','document','86420975310'));
  update public.profiles set trial_ends_at = now() + interval '30 days' where user_id in (u_owner_a, u_owner_b);

  insert into public.restaurants (name, slug) values ('Loja A', slug_a) returning id into r_a;
  insert into public.restaurants (name, slug) values ('Loja B', 'oiv-b') returning id into r_b;  -- B fica NAO publicada
  insert into public.restaurant_members (restaurant_id, user_id, role) values
    (r_a, u_owner_a, 'OWNER'), (r_a, u_staff_a, 'STAFF'), (r_b, u_owner_b, 'OWNER');
  update public.restaurants set onboarding_completed = true, status = 'active', service_pickup = true,
         payment_pix = true, payment_pix_key = 'pix@oiv.test', payment_pix_key_type = 'email' where id = r_a;
  delete from public.business_hours where restaurant_id = r_a;
  insert into public.business_hours (restaurant_id, day_of_week, opens_at, closes_at, period_order)
    select r_a, d, '00:00', '23:59:59', 1 from generate_series(0, 6) d;
  insert into public.categories (restaurant_id, name, display_order) values (r_a, 'c', 1) returning id into cat_a;
  insert into public.categories (restaurant_id, name, display_order) values (r_b, 'c', 1) returning id into cat_b;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_a, 'Pizza', 40, cat_a, 1) returning id into pizza;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_a, 'Suco', 8, cat_a, 2) returning id into suco;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_b, 'Pizza B', 50, cat_b, 1) returning id into pb;

  -- variantes pelas funcoes oficiais (OWNER)
  v_p := pg_temp._runas('authenticated', u_owner_a, format('select public.product_variant_create(%L, ''Pequena'', 35)::text', pizza))::uuid;
  v_m := pg_temp._runas('authenticated', u_owner_a, format('select public.product_variant_create(%L, ''Media'', 55.5)::text', pizza))::uuid;
  v_g := pg_temp._runas('authenticated', u_owner_a, format('select public.product_variant_create(%L, ''Grande'', 70, false)::text', pizza))::uuid;
  v_b := pg_temp._runas('authenticated', u_owner_b, format('select public.product_variant_create(%L, ''Unica'', 1)::text', pb))::uuid;

  -- adicional ligado a pizza (borda +5), inserido como dono do banco (sem claims de usuario)
  perform set_config('request.jwt.claims', '', true);
  insert into public.addon_groups (restaurant_id, name, display_order, max_selections) values (r_a, 'Borda', 1, 1) returning id into grp;
  insert into public.addons (restaurant_id, addon_group_id, name, price, display_order) values (r_a, grp, 'Catupiry', 5, 1) returning id into borda;
  insert into public.product_addon_groups (restaurant_id, product_id, addon_group_id, display_order) values (r_a, pizza, grp, 1);

  -- ---------- 0) catalogo ----------
  total := total + 1;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_items' and column_name = 'variant_id')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_items' and column_name = 'variant_name') then
    fails := fails || 'order_items sem variant_id/variant_name'::text;
  end if;
  total := total + 1;
  if not has_table_privilege('anon', 'public.product_variants', 'SELECT')
     or has_table_privilege('anon', 'public.product_variants', 'INSERT') or has_table_privilege('anon', 'public.product_variants', 'UPDATE')
     or has_table_privilege('anon', 'public.product_variants', 'DELETE')
     or has_table_privilege('authenticated', 'public.product_variants', 'INSERT') or has_table_privilege('authenticated', 'public.product_variants', 'UPDATE') then
    fails := fails || 'privilegios de product_variants incorretos (anon so SELECT; escrita so pelas funcoes)'::text;
  end if;
  total := total + 1;
  select count(*) into n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_order';
  if n <> 1 then fails := fails || format('create_order deveria ter 1 assinatura (n=%s)', n); end if;
  total := total + 1;
  if not (has_function_privilege('anon', 'public.create_order(text,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,text,numeric,text,numeric,text)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.create_order(text,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,text,numeric,text,numeric,text)', 'EXECUTE')) then
    fails := fails || 'create_order perdeu o EXECUTE de anon/authenticated'::text;
  end if;

  -- ---------- 1) leitura publica ----------
  res := pg_temp._runas('anon', null, format('select count(*)::text from public.product_variants where product_id = %L', pizza));
  total := total + 1;
  if res <> '3' then fails := fails || format('visitante deveria ver as 3 variantes da loja publicada (%s)', res); end if;
  res := pg_temp._runas('anon', null, 'select count(*)::text from public.product_variants where restaurant_id <> ''' || r_a || '''');
  total := total + 1;
  if res <> '0' then fails := fails || format('visitante viu variantes de loja NAO publicada (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_stranger, 'select count(*)::text from public.product_variants where restaurant_id = ''' || r_b || '''');
  total := total + 1;
  if res <> '0' then fails := fails || format('estranho viu variantes de loja NAO publicada (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, 'select count(*)::text from public.product_variants where restaurant_id = ''' || r_b || '''');
  total := total + 1;
  if res <> '1' then fails := fails || format('OWNER B deveria ver a propria variante (%s)', res); end if;
  res := pg_temp._runas('anon', null, format('update public.product_variants set price = 1 where id = %L returning 1', v_m));
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('visitante alterou variante (%s)', res); end if;

  -- ---------- 2) produto SEM variantes: pedido de sempre ----------
  res := pg_temp._order(slug_a, jsonb_build_array(jsonb_build_object('product_id', suco, 'quantity', 2)), 'oiv-1');
  select * into o from public.orders where restaurant_id = r_a and idempotency_key = 'oiv-1';
  select * into it from public.order_items where order_id = o.id;
  total := total + 1;
  if o.id is null or o.subtotal <> 16 or it.product_name <> 'Suco' or it.unit_price <> 8 or it.subtotal <> 16
     or it.variant_id is not null or it.variant_name is not null then
    fails := fails || format('2: produto sem variante mudou (%s | sub=%s nome=%s)', res, o.subtotal, it.product_name);
  end if;

  -- ---------- 3) produto COM variantes exige a escolha ----------
  res := pg_temp._order(slug_a, jsonb_build_array(jsonb_build_object('product_id', pizza, 'quantity', 1)), 'oiv-2');
  total := total + 1;
  if res not ilike '%variant_required%' then fails := fails || format('3: pedido sem variante aceito (%s)', res); end if;
  res := pg_temp._order(slug_a, jsonb_build_array(jsonb_build_object('product_id', pizza, 'quantity', 1, 'variant_id', '')), 'oiv-2b');
  total := total + 1;
  if res not ilike '%variant_required%' then fails := fails || format('3b: variant_id vazio aceito (%s)', res); end if;

  -- ---------- 4) preco da variante, do banco ----------
  res := pg_temp._order(slug_a, jsonb_build_array(jsonb_build_object('product_id', pizza, 'quantity', 2, 'variant_id', v_m,
                                                                     'price', 1, 'unit_price', 1, 'subtotal', 1)), 'oiv-3');
  select * into o from public.orders where restaurant_id = r_a and idempotency_key = 'oiv-3';
  select * into it from public.order_items where order_id = o.id;
  total := total + 1;
  if o.id is null or o.subtotal <> 111 or o.total <> 111 then
    fails := fails || format('4: subtotal deveria ser 2 x 55,50 = 111 (%s | sub=%s total=%s)', res, o.subtotal, o.total);
  end if;
  total := total + 1;
  if it.unit_price <> 55.5 or it.subtotal <> 111 or it.variant_id is distinct from v_m or it.variant_name is distinct from 'Media'
     or it.product_name is distinct from 'Pizza — Media' or it.product_id is distinct from pizza then
    fails := fails || format('4: item gravado errado (nome=%s unit=%s var=%s)', it.product_name, it.unit_price, it.variant_name);
  end if;

  -- ---------- 5) recusas ----------
  res := pg_temp._order(slug_a, jsonb_build_array(jsonb_build_object('product_id', pizza, 'quantity', 1, 'variant_id', v_g)), 'oiv-4');
  total := total + 1;
  if res not ilike '%variant_unavailable%' then fails := fails || format('5a: variante desligada aceita (%s)', res); end if;
  res := pg_temp._order(slug_a, jsonb_build_array(jsonb_build_object('product_id', suco, 'quantity', 1, 'variant_id', v_m)), 'oiv-5');
  total := total + 1;
  if res not ilike '%variant_not_found%' then fails := fails || format('5b: variante de OUTRO produto aceita (%s)', res); end if;
  res := pg_temp._order(slug_a, jsonb_build_array(jsonb_build_object('product_id', pizza, 'quantity', 1, 'variant_id', v_b)), 'oiv-6');
  total := total + 1;
  if res not ilike '%variant_not_found%' then fails := fails || format('5c: variante de OUTRA loja aceita (%s)', res); end if;
  res := pg_temp._order(slug_a, jsonb_build_array(jsonb_build_object('product_id', pizza, 'quantity', 1, 'variant_id', gen_random_uuid())), 'oiv-7');
  total := total + 1;
  if res not ilike '%variant_not_found%' then fails := fails || format('5d: variante inexistente aceita (%s)', res); end if;
  res := pg_temp._order(slug_a, jsonb_build_array(jsonb_build_object('product_id', pizza, 'quantity', 1, 'variant_id', 'nao-e-uuid')), 'oiv-8');
  total := total + 1;
  if res not ilike '%invalid_items%' then fails := fails || format('5e: variant_id malformado deveria ser invalid_items (%s)', res); end if;
  -- um item ruim derruba o pedido inteiro (nada gravado)
  res := pg_temp._order(slug_a, jsonb_build_array(jsonb_build_object('product_id', suco, 'quantity', 1),
                                                   jsonb_build_object('product_id', pizza, 'quantity', 1, 'variant_id', v_g)), 'oiv-9');
  select count(*) into n from public.orders where restaurant_id = r_a and idempotency_key in ('oiv-2', 'oiv-2b', 'oiv-4', 'oiv-5', 'oiv-6', 'oiv-7', 'oiv-8', 'oiv-9');
  total := total + 1;
  if n <> 0 then fails := fails || format('5f: pedido recusado deixou registro (n=%s)', n); end if;

  -- ---------- 6) adicional soma sobre a variante; cupom incide sobre o subtotal da variante ----------
  perform set_config('request.jwt.claims', '', true);
  insert into public.coupons (restaurant_id, code, discount_type, discount_value) values (r_a, 'DEZ', 'percent', 10);
  res := pg_temp._order(slug_a, jsonb_build_array(jsonb_build_object('product_id', pizza, 'quantity', 2, 'variant_id', v_p, 'addon_ids', jsonb_build_array(borda))), 'oiv-10', 'DEZ');
  select * into o from public.orders where restaurant_id = r_a and idempotency_key = 'oiv-10';
  select * into it from public.order_items where order_id = o.id;
  total := total + 1;
  -- (35 + 5) x 2 = 80; 10% = 8; total 72
  if o.id is null or o.subtotal <> 80 or o.discount_amount <> 8 or o.total <> 72 or o.coupon_code is distinct from 'DEZ' then
    fails := fails || format('6: variante+adicional+cupom (%s | sub=%s desc=%s total=%s)', res, o.subtotal, o.discount_amount, o.total);
  end if;
  total := total + 1;
  if it.unit_price <> 35 or it.subtotal <> 70
     or (select count(*) from public.order_item_addons a where a.order_item_id = it.id and a.subtotal = 10) <> 1 then
    fails := fails || format('6: item/adicional gravado errado (unit=%s sub=%s)', it.unit_price, it.subtotal);
  end if;

  -- ---------- 7) idempotencia: mesma chave, mesmo pedido, sem itens duplicados ----------
  res := pg_temp._order(slug_a, jsonb_build_array(jsonb_build_object('product_id', pizza, 'quantity', 2, 'variant_id', v_m)), 'oiv-3');
  select count(*) into n from public.orders where restaurant_id = r_a and idempotency_key = 'oiv-3';
  total := total + 1;
  if n <> 1 or (select count(*) from public.order_items i join public.orders x on x.id = i.order_id where x.restaurant_id = r_a and x.idempotency_key = 'oiv-3') <> 1 then
    fails := fails || format('7: repeticao duplicou o pedido (%s | n=%s)', res, n);
  end if;

  -- ---------- 8) PDV (counter) pela equipe: mesma regra ----------
  res := pg_temp._runas('authenticated', u_staff_a, format(
    'select public_id::text from public.create_order(%L, ''Balcao'', '''', ''counter'', ''cash'', %L::jsonb, ''oiv-pdv-1'')',
    slug_a, jsonb_build_array(jsonb_build_object('product_id', pizza, 'quantity', 1, 'variant_id', v_p))::text));
  select * into o from public.orders where restaurant_id = r_a and idempotency_key = 'oiv-pdv-1';
  select * into it from public.order_items where order_id = o.id;
  total := total + 1;
  if o.id is null or o.subtotal <> 35 or it.variant_id is distinct from v_p or it.product_name is distinct from 'Pizza — Pequena' then
    fails := fails || format('8: PDV com variante (%s | sub=%s nome=%s)', res, o.subtotal, it.product_name);
  end if;
  res := pg_temp._runas('authenticated', u_staff_a, format(
    'select public_id::text from public.create_order(%L, ''Balcao'', '''', ''counter'', ''cash'', %L::jsonb, ''oiv-pdv-2'')',
    slug_a, jsonb_build_array(jsonb_build_object('product_id', pizza, 'quantity', 1))::text));
  total := total + 1;
  if res not ilike '%variant_required%' then fails := fails || format('8b: PDV sem variante aceito (%s)', res); end if;

  -- ---------- 9) variante desligada depois: pedido antigo intacto; apagar preserva o historico ----------
  perform pg_temp._runas('authenticated', u_staff_a, format('select public.product_variant_set_available(%L, false)::text', v_m));
  res := pg_temp._order(slug_a, jsonb_build_array(jsonb_build_object('product_id', pizza, 'quantity', 1, 'variant_id', v_m)), 'oiv-11');
  total := total + 1;
  if res not ilike '%variant_unavailable%' then fails := fails || format('9a: variante desligada pela equipe ainda vende (%s)', res); end if;
  perform pg_temp._runas('authenticated', u_owner_a, format('select public.product_variant_delete(%L)::text', v_m));
  select i.* into it from public.order_items i join public.orders x on x.id = i.order_id where x.restaurant_id = r_a and x.idempotency_key = 'oiv-3';
  total := total + 1;
  if exists (select 1 from public.product_variants where id = v_m) then
    fails := fails || '9b: variante nao foi apagada (teste invalido)'::text;
  elsif it.variant_id is not null or it.variant_name is distinct from 'Media' or it.unit_price <> 55.5 or it.product_name is distinct from 'Pizza — Media' then
    fails := fails || format('9b: historico do item mudou ao apagar a variante (var=%s nome=%s)', it.variant_name, it.product_name);
  end if;

  -- ---------- 10) produto que perdeu todas as variantes volta ao preco do produto ----------
  perform pg_temp._runas('authenticated', u_owner_a, format('select public.product_variant_delete(%L)::text', v_p));
  perform pg_temp._runas('authenticated', u_owner_a, format('select public.product_variant_delete(%L)::text', v_g));
  res := pg_temp._order(slug_a, jsonb_build_array(jsonb_build_object('product_id', pizza, 'quantity', 1)), 'oiv-12');
  select * into o from public.orders where restaurant_id = r_a and idempotency_key = 'oiv-12';
  total := total + 1;
  if o.id is null or o.subtotal <> 40 then fails := fails || format('10: sem variantes deveria valer o preco do produto (%s | sub=%s)', res, o.subtotal); end if;

  -- ---------- relatorio ----------
  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes', total;
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %', array_length(fails, 1), total, array_to_string(fails, ' ## ');
  end if;
end $$;
