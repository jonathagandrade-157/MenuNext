-- MenuNext — teste de regressão: promoções automáticas.
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO (local ou branch). Cria usuários e lojas de teste; tudo fica
-- numa transação que SEMPRE termina com `raise exception` (nada persiste).
-- Resultado: a mensagem final do erro é o relatório ("RESULTADO: OK | N verificacoes" ou "FALHOU").
--
-- Regras testadas: tabela só escrita pelo OWNER (STAFF lê, estranho e visitante não); constraints; escolha da
-- melhor promoção por subtotal, mínimo, período, dia da semana e horário (fuso de São Paulo, 22:00 já fora);
-- preview público; create_order de ponta a ponta: sem promoção o pedido é o mesmo de sempre, promoção x cupom
-- (o maior vence, empate fica com o cupom, o uso do cupom só é consumido se ele vencer), promoção de outra
-- loja não vale, cupom inválido continua dando erro, idempotência, histórico sobrevive à exclusão.

do $$
declare
  u_owner_a uuid := gen_random_uuid();
  u_staff_a uuid := gen_random_uuid();
  u_owner_b uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  r_a uuid; r_b uuid; cat_a uuid; prod_a uuid; prod_b uuid; cat_b uuid;
  promo_a uuid; promo_b uuid; promo_x uuid; coupon_a uuid;
  slug_a text := 'pr-loja-a';
  items_a text; o record; b record; n bigint; err text; tmp numeric;
  fails text[] := '{}'; total int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_owner_a, 'owner-a@pr.test', jsonb_build_object('name','Dona A','phone','11999990001','document','12345678062')),
    (u_staff_a, 'staff-a@pr.test', jsonb_build_object('name','Equipe A','phone','11999990002','document','98765432029')),
    (u_owner_b, 'owner-b@pr.test', jsonb_build_object('name','Dono B','phone','11999990003','document','24681357090')),
    (u_stranger,'stranger@pr.test',jsonb_build_object('name','Estranho','phone','11999990005','document','86420975310'));
  update public.profiles set trial_ends_at = now() + interval '30 days' where user_id in (u_owner_a, u_owner_b);

  insert into public.restaurants (name, slug) values ('Loja A', slug_a) returning id into r_a;
  insert into public.restaurants (name, slug) values ('Loja B', 'pr-loja-b') returning id into r_b;
  insert into public.restaurant_members (restaurant_id, user_id, role) values
    (r_a, u_owner_a, 'OWNER'), (r_a, u_staff_a, 'STAFF'), (r_b, u_owner_b, 'OWNER');
  update public.restaurants set onboarding_completed = true, status = 'active', service_pickup = true,
         payment_pix = true, payment_pix_key = 'pix@pr.test', payment_pix_key_type = 'email' where id = r_a;
  delete from public.business_hours where restaurant_id = r_a;
  insert into public.business_hours (restaurant_id, day_of_week, opens_at, closes_at, period_order)
    select r_a, d, '00:00', '23:59:59', 1 from generate_series(0, 6) d;
  insert into public.categories (restaurant_id, name, display_order) values (r_a, 'cat-a', 1) returning id into cat_a;
  insert into public.categories (restaurant_id, name, display_order) values (r_b, 'cat-b', 1) returning id into cat_b;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_a, 'prod-a', 40, cat_a, 1) returning id into prod_a;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_b, 'prod-b', 40, cat_b, 1) returning id into prod_b;
  items_a := jsonb_build_array(jsonb_build_object('product_id', prod_a, 'quantity', 2))::text;  -- subtotal 80

  -- ---------- 0) catálogo e privilégios ----------
  total := total + 1;
  if not exists (select 1 from pg_class where oid = 'public.promotions'::regclass and relrowsecurity) then
    fails := fails || 'promotions sem RLS'::text;
  end if;
  total := total + 1;
  if has_function_privilege('anon', 'public._promotion_best(uuid,numeric,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._promotion_best(uuid,numeric,timestamptz)', 'EXECUTE') then
    fails := fails || '_promotion_best exposta'::text;
  end if;
  total := total + 1;
  if not (has_function_privilege('anon', 'public.preview_promotion(text,numeric)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.preview_promotion(text,numeric)', 'EXECUTE')) then
    fails := fails || 'preview_promotion deveria ser publica'::text;
  end if;
  total := total + 1;
  select count(*) into n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_order';
  if n <> 1 then fails := fails || format('create_order deveria ter 1 assinatura (n=%s)', n); end if;
  total := total + 1;
  if not (has_function_privilege('anon', 'public.create_order(text,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,text,numeric,text,numeric,text)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.create_order(text,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,text,numeric,text,numeric,text)', 'EXECUTE')) then
    fails := fails || 'create_order perdeu o EXECUTE de anon/authenticated'::text;
  end if;
  total := total + 1;
  if has_table_privilege('anon', 'public.promotions', 'SELECT') then fails := fails || 'anon le a tabela promotions'::text; end if;

  -- ---------- 1) quem escreve ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.promotions (restaurant_id, name, discount_type, discount_value, min_order_value)
  values (r_a, 'Promo 10', 'percent', 10, 50) returning id into promo_a;
  reset role;
  total := total + 1;
  if promo_a is null then fails := fails || 'OWNER nao criou promocao'::text; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_staff_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.promotions (restaurant_id, name, discount_type, discount_value) values (r_a, 'Hack', 'fixed', 1);
    err := 'ok';
  exception when others then err := sqlerrm; end;
  select count(*) into n from public.promotions where restaurant_id = r_a;
  reset role;
  total := total + 1;
  if err not ilike '%row-level security%' then fails := fails || format('STAFF criou promocao (%s)', err); end if;
  total := total + 1;
  if n <> 1 then fails := fails || format('STAFF deveria ler a promocao da propria loja (n=%s)', n); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_staff_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.promotions set discount_value = 99 where id = promo_a;
  get diagnostics n = row_count;
  reset role;
  total := total + 1;
  if n <> 0 or (select discount_value from public.promotions where id = promo_a) <> 10 then
    fails := fails || 'STAFF alterou a promocao'::text;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.promotions;
  update public.promotions set is_active = false where id = promo_a;
  get diagnostics tmp = row_count;
  begin
    insert into public.promotions (restaurant_id, name, discount_type, discount_value) values (r_a, 'Invasao', 'fixed', 1);
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if n <> 0 then fails := fails || format('OWNER B enxerga promocao da loja A (n=%s)', n); end if;
  total := total + 1;
  if tmp <> 0 or not (select is_active from public.promotions where id = promo_a) then fails := fails || 'OWNER B desligou promocao da loja A'::text; end if;
  total := total + 1;
  if err not ilike '%row-level security%' then fails := fails || format('OWNER B criou promocao na loja A (%s)', err); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.promotions;
  reset role;
  total := total + 1;
  if n <> 0 then fails := fails || 'usuario sem loja leu promocoes'::text; end if;

  set local role anon;
  begin perform count(*) from public.promotions; err := 'ok'; exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%permission denied%' then fails := fails || format('visitante leu a tabela (%s)', err); end if;

  -- ---------- 2) constraints ----------
  total := total + 1;
  begin insert into public.promotions (restaurant_id, name, discount_type, discount_value) values (r_a, 'Cem e um', 'percent', 101); err := 'ok'; exception when check_violation then err := 'bloqueou'; end;
  if err <> 'bloqueou' then fails := fails || 'percentual acima de 100 aceito'::text; end if;
  total := total + 1;
  begin insert into public.promotions (restaurant_id, name, discount_type, discount_value) values (r_a, 'Zero', 'fixed', 0); err := 'ok'; exception when check_violation then err := 'bloqueou'; end;
  if err <> 'bloqueou' then fails := fails || 'valor zero aceito'::text; end if;
  total := total + 1;
  begin insert into public.promotions (restaurant_id, name, discount_type, discount_value, time_from, time_to) values (r_a, 'Hora', 'fixed', 5, '22:00', '18:00'); err := 'ok'; exception when check_violation then err := 'bloqueou'; end;
  if err <> 'bloqueou' then fails := fails || 'janela de horario invertida aceita'::text; end if;
  total := total + 1;
  begin insert into public.promotions (restaurant_id, name, discount_type, discount_value, time_from) values (r_a, 'Meia', 'fixed', 5, '18:00'); err := 'ok'; exception when check_violation then err := 'bloqueou'; end;
  if err <> 'bloqueou' then fails := fails || 'horario so com inicio aceito'::text; end if;
  total := total + 1;
  begin insert into public.promotions (restaurant_id, name, discount_type, discount_value, weekdays) values (r_a, 'Dia', 'fixed', 5, array[7]::smallint[]); err := 'ok'; exception when check_violation then err := 'bloqueou'; end;
  if err <> 'bloqueou' then fails := fails || 'dia da semana 7 aceito'::text; end if;
  total := total + 1;
  begin insert into public.promotions (restaurant_id, name, discount_type, discount_value, starts_at, ends_at) values (r_a, 'Periodo', 'fixed', 5, now(), now() - interval '1 day'); err := 'ok'; exception when check_violation then err := 'bloqueou'; end;
  if err <> 'bloqueou' then fails := fails || 'periodo invertido aceito'::text; end if;
  total := total + 1;
  begin insert into public.promotions (restaurant_id, name, discount_type, discount_value) values (r_a, 'X', 'fixed', 5); err := 'ok'; exception when check_violation then err := 'bloqueou'; end;
  if err <> 'bloqueou' then fails := fails || 'nome de 1 letra aceito'::text; end if;

  -- ---------- 3) escolha da melhor promoção (_promotion_best, tempo injetado) ----------
  update public.promotions set is_active = true where id = promo_a;     -- Promo 10: 10%, mínimo 50
  insert into public.promotions (restaurant_id, name, discount_type, discount_value, min_order_value) values (r_a, 'Promo 8 reais', 'fixed', 8, 100) returning id into promo_b;

  select * into b from public._promotion_best(r_a, 40, now());
  total := total + 1;
  if b.promotion_id is not null then fails := fails || 'promocao aplicada abaixo do minimo'::text; end if;
  select * into b from public._promotion_best(r_a, 60, now());
  total := total + 1;
  if b.promotion_id is distinct from promo_a or b.discount_amount <> 6 then fails := fails || format('subtotal 60: esperado 6,00 da Promo 10 (veio %s)', b.discount_amount); end if;
  select * into b from public._promotion_best(r_a, 100, now());
  total := total + 1;
  if b.promotion_id is distinct from promo_a or b.discount_amount <> 10 then fails := fails || format('subtotal 100: o maior (10,00) deveria vencer (veio %s)', b.discount_amount); end if;
  select * into b from public._promotion_best(r_a, 33.33, now());
  total := total + 1;
  if b.promotion_id is not null then fails := fails || 'subtotal 33,33 deveria ficar sem promocao'::text; end if;

  update public.promotions set min_order_value = null where id = promo_a;
  select * into b from public._promotion_best(r_a, 33.33, now());
  total := total + 1;
  if b.discount_amount <> 3.33 then fails := fails || format('arredondamento: 10%% de 33,33 = 3,33 (veio %s)', b.discount_amount); end if;

  update public.promotions set is_active = false where id = promo_a;
  select * into b from public._promotion_best(r_a, 100, now());
  total := total + 1;
  if b.promotion_id is distinct from promo_b or b.discount_amount <> 8 then fails := fails || 'promocao desligada ainda vale (ou a de 8 reais nao assumiu)'::text; end if;
  update public.promotions set is_active = false where id = promo_b;
  select * into b from public._promotion_best(r_a, 100, now());
  total := total + 1;
  if b.promotion_id is not null then fails := fails || 'sem promocoes ativas ainda devolveu desconto'::text; end if;

  -- desconto fixo maior que o subtotal fica limitado ao subtotal
  insert into public.promotions (restaurant_id, name, discount_type, discount_value) values (r_a, 'Fixo gigante', 'fixed', 500) returning id into promo_x;
  select * into b from public._promotion_best(r_a, 60, now());
  total := total + 1;
  if b.promotion_id is distinct from promo_x or b.discount_amount <> 60 then fails := fails || format('desconto fixo deveria ficar limitado ao subtotal (veio %s)', b.discount_amount); end if;
  delete from public.promotions where id = promo_x;

  -- janela de horario 18:00-22:00 e dias (segunda e sexta), fuso de Sao Paulo. 26/10/2026 = segunda.
  insert into public.promotions (restaurant_id, name, discount_type, discount_value, weekdays, time_from, time_to)
  values (r_a, 'Happy hour', 'fixed', 5, array[1, 5]::smallint[], '18:00', '22:00') returning id into promo_x;
  total := total + 1;
  if (select count(*) from public._promotion_best(r_a, 60, '2026-10-26 17:59:00-03')) <> 0 then fails := fails || 'happy hour valeu as 17:59'::text; end if;
  total := total + 1;
  if (select count(*) from public._promotion_best(r_a, 60, '2026-10-26 18:00:00-03')) <> 1 then fails := fails || 'happy hour nao valeu as 18:00 (segunda)'::text; end if;
  total := total + 1;
  if (select count(*) from public._promotion_best(r_a, 60, '2026-10-26 21:59:59-03')) <> 1 then fails := fails || 'happy hour nao valeu as 21:59:59'::text; end if;
  total := total + 1;
  if (select count(*) from public._promotion_best(r_a, 60, '2026-10-26 22:00:00-03')) <> 0 then fails := fails || 'happy hour valeu as 22:00'::text; end if;
  total := total + 1;
  if (select count(*) from public._promotion_best(r_a, 60, '2026-10-27 19:00:00-03')) <> 0 then fails := fails || 'happy hour valeu na terca'::text; end if;
  total := total + 1;
  if (select count(*) from public._promotion_best(r_a, 60, '2026-10-30 19:00:00-03')) <> 1 then fails := fails || 'happy hour nao valeu na sexta'::text; end if;
  -- 01:30 UTC de terca = 22:30 de segunda em Sao Paulo (fora); 23:30 UTC de segunda = 20:30 (dentro)
  total := total + 1;
  if (select count(*) from public._promotion_best(r_a, 60, '2026-10-27 01:30:00+00')) <> 0 then fails := fails || 'fuso: 22:30 de Sao Paulo deveria estar fora'::text; end if;
  total := total + 1;
  if (select count(*) from public._promotion_best(r_a, 60, '2026-10-26 23:30:00+00')) <> 1 then fails := fails || 'fuso: 20:30 de Sao Paulo deveria estar dentro'::text; end if;

  update public.promotions set weekdays = null, time_from = null, time_to = null, starts_at = '2026-11-01 00:00:00-03', ends_at = '2026-11-10 00:00:00-03' where id = promo_x;
  total := total + 1;
  if (select count(*) from public._promotion_best(r_a, 60, '2026-10-31 23:59:59-03')) <> 0 then fails := fails || 'promocao valeu antes do inicio'::text; end if;
  total := total + 1;
  if (select count(*) from public._promotion_best(r_a, 60, '2026-11-01 00:00:00-03')) <> 1 then fails := fails || 'promocao nao valeu no instante do inicio'::text; end if;
  total := total + 1;
  if (select count(*) from public._promotion_best(r_a, 60, '2026-11-10 00:00:00-03')) <> 0 then fails := fails || 'promocao valeu no instante do fim'::text; end if;
  delete from public.promotions where id = promo_x;

  -- empate: vale a mais antiga
  insert into public.promotions (restaurant_id, name, discount_type, discount_value, created_at) values (r_a, 'Empate velha', 'fixed', 6, now() - interval '1 day') returning id into promo_x;
  insert into public.promotions (restaurant_id, name, discount_type, discount_value) values (r_a, 'Empate nova', 'fixed', 6);
  select * into b from public._promotion_best(r_a, 60, now());
  total := total + 1;
  if b.promotion_id is distinct from promo_x then fails := fails || 'empate de valor deveria ficar com a mais antiga'::text; end if;
  delete from public.promotions where restaurant_id = r_a;

  -- ---------- 4) preview publico ----------
  insert into public.promotions (restaurant_id, name, discount_type, discount_value) values (r_a, 'Preview 10', 'percent', 10);
  insert into public.promotions (restaurant_id, name, discount_type, discount_value) values (r_b, 'Preview B', 'percent', 50);
  set local role anon;
  select * into b from public.preview_promotion(slug_a, 80);
  reset role;
  total := total + 1;
  if b.name is distinct from 'Preview 10' or b.discount_amount <> 8 then fails := fails || format('preview anon inesperado (%s / %s)', b.name, b.discount_amount); end if;
  set local role anon;
  select count(*) into n from public.preview_promotion('nao-existe-xyz', 80);
  reset role;
  total := total + 1;
  if n <> 0 then fails := fails || 'preview de loja inexistente devolveu linha'::text; end if;
  set local role anon;
  select count(*) into n from public.preview_promotion('pr-loja-b', 80);  -- loja B nao publicada
  reset role;
  total := total + 1;
  if n <> 0 then fails := fails || 'preview de loja nao publicada devolveu linha'::text; end if;
  set local role anon;
  select count(*) into n from public.preview_promotion(slug_a, null);
  reset role;
  total := total + 1;
  if n <> 0 then fails := fails || 'preview com subtotal nulo devolveu linha'::text; end if;
  set local role anon;
  select count(*) into n from public.preview_promotion(slug_a, -5);
  reset role;
  total := total + 1;
  if n <> 0 then fails := fails || 'preview com subtotal negativo devolveu linha'::text; end if;
  delete from public.promotions where restaurant_id in (r_a, r_b);

  -- ---------- 5) create_order de ponta a ponta ----------
  insert into public.coupons (restaurant_id, code, discount_type, discount_value) values (r_a, 'CUPOM50', 'percent', 50) returning id into coupon_a;
  insert into public.coupons (restaurant_id, code, discount_type, discount_value) values (r_a, 'CUPOM5', 'percent', 5);
  insert into public.coupons (restaurant_id, code, discount_type, discount_value) values (r_a, 'CUPOM10', 'percent', 10);

  -- 5a) sem nenhuma promocao: pedido identico ao de antes (80, sem desconto, sem promocao)
  set local role anon;
  perform * from public.create_order(slug_a, 'Cliente', '11988887777', 'pickup', 'cash', items_a::jsonb, 'pr-a1');
  reset role;
  select * into o from public.orders where restaurant_id = r_a and idempotency_key = 'pr-a1';
  total := total + 1;
  if o.subtotal <> 80 or o.discount_amount <> 0 or o.total <> 80 or o.promotion_id is not null or o.promotion_name is not null or o.coupon_id is not null then
    fails := fails || format('5a: sem promocao o pedido mudou (sub=%s desc=%s total=%s)', o.subtotal, o.discount_amount, o.total);
  end if;

  -- 5b) promocao 10%% aplicada sozinha (anon, retirada)
  insert into public.promotions (restaurant_id, name, discount_type, discount_value) values (r_a, 'Dez por cento', 'percent', 10) returning id into promo_a;
  set local role anon;
  perform * from public.create_order(slug_a, 'Cliente', '11988887777', 'pickup', 'cash', items_a::jsonb, 'pr-b1');
  reset role;
  select * into o from public.orders where restaurant_id = r_a and idempotency_key = 'pr-b1';
  total := total + 1;
  if o.subtotal <> 80 or o.discount_amount <> 8 or o.total <> 72 or o.promotion_id is distinct from promo_a or o.promotion_name is distinct from 'Dez por cento' or o.coupon_id is not null then
    fails := fails || format('5b: promocao 10%% (sub=%s desc=%s total=%s nome=%s)', o.subtotal, o.discount_amount, o.total, o.promotion_name);
  end if;
  total := total + 1;
  select count(*) into n from public.order_items where order_id = o.id;
  if n <> 1 then fails := fails || 'itens do pedido alterados'::text; end if;

  -- 5c) cupom maior (50%%) vence a promocao e consome 1 uso
  set local role anon;
  perform * from public.create_order(slug_a, 'Cliente', '11988887777', 'pickup', 'cash', items_a::jsonb, 'pr-c1', null, null, null, null, null, null, null, null, null, null, null, 'CUPOM50');
  reset role;
  select * into o from public.orders where restaurant_id = r_a and idempotency_key = 'pr-c1';
  total := total + 1;
  if o.discount_amount <> 40 or o.total <> 40 or o.coupon_code is distinct from 'CUPOM50' or o.promotion_id is not null or o.promotion_name is not null then
    fails := fails || format('5c: cupom maior deveria vencer (desc=%s cupom=%s promo=%s)', o.discount_amount, o.coupon_code, o.promotion_name);
  end if;
  total := total + 1;
  if (select uses_count from public.coupons where id = coupon_a) <> 1 then fails := fails || '5c: uso do cupom vencedor nao foi consumido'::text; end if;

  -- 5d) promocao maior (10%%) vence cupom menor (5%%): cupom NAO consome uso e nao fica no pedido
  set local role anon;
  perform * from public.create_order(slug_a, 'Cliente', '11988887777', 'pickup', 'cash', items_a::jsonb, 'pr-d1', null, null, null, null, null, null, null, null, null, null, null, 'CUPOM5');
  reset role;
  select * into o from public.orders where restaurant_id = r_a and idempotency_key = 'pr-d1';
  total := total + 1;
  if o.discount_amount <> 8 or o.total <> 72 or o.promotion_id is distinct from promo_a or o.coupon_id is not null or o.coupon_code is not null then
    fails := fails || format('5d: promocao maior deveria vencer (desc=%s cupom=%s)', o.discount_amount, o.coupon_code);
  end if;
  total := total + 1;
  if (select uses_count from public.coupons where restaurant_id = r_a and code = 'CUPOM5') <> 0 then fails := fails || '5d: cupom perdedor consumiu um uso'::text; end if;

  -- 5e) empate (cupom 10%% = promocao 10%%): fica com o cupom e consome o uso
  set local role anon;
  perform * from public.create_order(slug_a, 'Cliente', '11988887777', 'pickup', 'cash', items_a::jsonb, 'pr-e1', null, null, null, null, null, null, null, null, null, null, null, 'CUPOM10');
  reset role;
  select * into o from public.orders where restaurant_id = r_a and idempotency_key = 'pr-e1';
  total := total + 1;
  if o.discount_amount <> 8 or o.coupon_code is distinct from 'CUPOM10' or o.promotion_id is not null then
    fails := fails || format('5e: empate deveria ficar com o cupom (cupom=%s promo=%s)', o.coupon_code, o.promotion_name);
  end if;
  total := total + 1;
  if (select uses_count from public.coupons where restaurant_id = r_a and code = 'CUPOM10') <> 1 then fails := fails || '5e: uso do cupom empatado nao foi consumido'::text; end if;

  -- 5f) cupom invalido continua dando erro mesmo havendo promocao
  set local role anon;
  begin
    perform * from public.create_order(slug_a, 'Cliente', '11988887777', 'pickup', 'cash', items_a::jsonb, 'pr-f1', null, null, null, null, null, null, null, null, null, null, null, 'NAOEXISTE');
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%coupon_not_found%' then fails := fails || format('5f: cupom invalido deveria falhar (%s)', err); end if;
  total := total + 1;
  if exists (select 1 from public.orders where restaurant_id = r_a and idempotency_key = 'pr-f1') then fails := fails || '5f: pedido criado com cupom invalido'::text; end if;

  -- 5g) idempotencia: repetir a chave devolve o mesmo pedido, sem novo desconto nem novo pedido
  select count(*) into n from public.orders where restaurant_id = r_a;
  set local role anon;
  perform * from public.create_order(slug_a, 'Cliente', '11988887777', 'pickup', 'cash', items_a::jsonb, 'pr-b1');
  reset role;
  total := total + 1;
  if (select count(*) from public.orders where restaurant_id = r_a) <> n then fails := fails || '5g: idempotencia criou outro pedido'::text; end if;

  -- 5h) minimo da promocao: abaixo do minimo nao desconta
  update public.promotions set min_order_value = 100 where id = promo_a;
  set local role anon;
  perform * from public.create_order(slug_a, 'Cliente', '11988887777', 'pickup', 'cash', items_a::jsonb, 'pr-h1');
  reset role;
  select * into o from public.orders where restaurant_id = r_a and idempotency_key = 'pr-h1';
  total := total + 1;
  if o.discount_amount <> 0 or o.total <> 80 or o.promotion_id is not null then fails := fails || '5h: promocao valeu abaixo do minimo'::text; end if;

  -- 5i) promocao de outra loja nao vale na loja A; desligada tambem nao
  update public.promotions set min_order_value = null, is_active = false where id = promo_a;
  insert into public.promotions (restaurant_id, name, discount_type, discount_value) values (r_b, 'Promo da B', 'percent', 90);
  set local role anon;
  perform * from public.create_order(slug_a, 'Cliente', '11988887777', 'pickup', 'cash', items_a::jsonb, 'pr-i1');
  reset role;
  select * into o from public.orders where restaurant_id = r_a and idempotency_key = 'pr-i1';
  total := total + 1;
  if o.discount_amount <> 0 or o.promotion_id is not null then fails := fails || '5i: promocao desligada ou de outra loja foi aplicada'::text; end if;

  -- 5j) venda de balcao (membro autenticado) tambem recebe a promocao
  update public.promotions set is_active = true where id = promo_a;
  perform set_config('request.jwt.claims', json_build_object('sub', u_staff_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform * from public.create_order(slug_a, 'Balcao', '11966665555', 'counter', 'cash', items_a::jsonb, 'pr-j1');
  reset role;
  select * into o from public.orders where restaurant_id = r_a and idempotency_key = 'pr-j1';
  total := total + 1;
  if o.fulfillment_type <> 'counter' or o.discount_amount <> 8 or o.total <> 72 or o.promotion_id is distinct from promo_a then
    fails := fails || format('5j: balcao sem promocao (desc=%s)', o.discount_amount);
  end if;

  -- 5k) excluir a promocao preserva o historico do pedido (nome fica, id vira nulo)
  delete from public.promotions where id = promo_a;
  select * into o from public.orders where restaurant_id = r_a and idempotency_key = 'pr-b1';
  total := total + 1;
  if o.promotion_id is not null or o.promotion_name is distinct from 'Dez por cento' or o.discount_amount <> 8 then
    fails := fails || '5k: historico do pedido nao sobreviveu a exclusao da promocao'::text;
  end if;

  -- ---------- relatório ----------
  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes', total;
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %', array_length(fails, 1), total, array_to_string(fails, ' ## ');
  end if;
end $$;
