-- MenuNext — teste de regressão: proteção do checkout público (migrations 20261027010000 e 20261027020000).
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO (local ou branch). Cria usuários e lojas de teste; tudo fica numa
-- transação que SEMPRE termina com `raise exception` (nada persiste).
-- Resultado: a mensagem final do erro é o relatório ("RESULTADO: OK | N verificacoes" ou "FALHOU").
--
-- Regras testadas:
--   * create_order, validate_coupon, preview_promotion e is_document_eligible NÃO são executáveis por visitante,
--     usuário logado, OWNER nem STAFF pela API; só pelo servidor (service_role);
--   * o checkout pelo servidor segue funcionando: pedido, idempotência (repetir a chave não duplica nem gasta
--     cupom de novo), item de outra loja recusado, loja fechada/não publicada recusada;
--   * cupom: validar não consome; pedido recusado não consome; limite de usos respeitado;
--   * venda de balcão só por create_counter_order e só para membro da própria loja (OWNER e STAFF);
--   * retaguarda no banco: no máximo 10 pedidos online por telefone e 300 por loja em 10 minutos, independente de
--     quem chamou; balcão e outras lojas não são afetados; depois da janela volta a aceitar.

do $$
declare
  u_owner_a uuid := gen_random_uuid();
  u_staff_a uuid := gen_random_uuid();
  u_owner_b uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  u_owner_c uuid := gen_random_uuid();
  r_a uuid; r_b uuid; r_c uuid; cat_a uuid; cat_b uuid; prod_a uuid; prod_b uuid; prod_c uuid; cat_c uuid;
  coupon_one uuid; coupon_min uuid;
  slug_a text := 'cp-loja-a'; slug_b text := 'cp-loja-b'; slug_c text := 'cp-loja-fechada';
  items_a text; items_b text;
  o record; n bigint; err text; i int; v_uses int;
  fails text[] := '{}'; total int := 0;
  create_sig text := 'public.create_order(text,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,text,numeric,text,numeric,text)';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_owner_a, 'owner-a@cp.test', jsonb_build_object('name','Dona A','phone','11999990001','document','12345678062')),
    (u_staff_a, 'staff-a@cp.test', jsonb_build_object('name','Equipe A','phone','11999990002','document','98765432029')),
    (u_owner_b, 'owner-b@cp.test', jsonb_build_object('name','Dono B','phone','11999990003','document','24681357090')),
    (u_stranger,'stranger@cp.test',jsonb_build_object('name','Estranho','phone','11999990005','document','86420975310')),
    (u_owner_c, 'owner-c@cp.test', jsonb_build_object('name','Dono C','phone','11999990006','document','11144477735'));
  update public.profiles set trial_ends_at = now() + interval '30 days' where user_id in (u_owner_a, u_owner_b, u_owner_c);

  insert into public.restaurants (name, slug) values ('Loja A', slug_a) returning id into r_a;
  insert into public.restaurants (name, slug) values ('Loja B', slug_b) returning id into r_b;
  insert into public.restaurants (name, slug) values ('Loja C', slug_c) returning id into r_c;
  insert into public.restaurant_members (restaurant_id, user_id, role) values
    (r_a, u_owner_a, 'OWNER'), (r_a, u_staff_a, 'STAFF'), (r_b, u_owner_b, 'OWNER'), (r_c, u_owner_c, 'OWNER');
  update public.restaurants set onboarding_completed = true, status = 'active', service_pickup = true,
         payment_pix = true, payment_pix_key = 'pix@cp.test', payment_pix_key_type = 'email' where id in (r_a, r_b);
  update public.restaurants set onboarding_completed = true, status = 'active', service_pickup = true where id = r_c;
  delete from public.business_hours where restaurant_id in (r_a, r_b);
  insert into public.business_hours (restaurant_id, day_of_week, opens_at, closes_at, period_order)
    select r, d, '00:00', '23:59:59', 1 from unnest(array[r_a, r_b]) r, generate_series(0, 6) d;
  -- Loja C: aberta apenas por 1 minuto em um horário em que NÃO estamos (sempre fechada)
  delete from public.business_hours where restaurant_id = r_c;
  insert into public.business_hours (restaurant_id, day_of_week, opens_at, closes_at, period_order)
    select r_c, d, '03:00', '03:00:01', 1 from generate_series(0, 6) d;

  insert into public.categories (restaurant_id, name, display_order) values (r_a, 'cat-a', 1) returning id into cat_a;
  insert into public.categories (restaurant_id, name, display_order) values (r_b, 'cat-b', 1) returning id into cat_b;
  insert into public.categories (restaurant_id, name, display_order) values (r_c, 'cat-c', 1) returning id into cat_c;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_a, 'prod-a', 40, cat_a, 1) returning id into prod_a;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_b, 'prod-b', 40, cat_b, 1) returning id into prod_b;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_c, 'prod-c', 40, cat_c, 1) returning id into prod_c;
  items_a := jsonb_build_array(jsonb_build_object('product_id', prod_a, 'quantity', 1))::text;   -- subtotal 40
  items_b := jsonb_build_array(jsonb_build_object('product_id', prod_b, 'quantity', 1))::text;
  insert into public.coupons (restaurant_id, code, discount_type, discount_value, max_uses) values (r_a, 'UMUSO', 'fixed', 5, 1) returning id into coupon_one;
  insert into public.coupons (restaurant_id, code, discount_type, discount_value, min_order_value) values (r_a, 'MIN100', 'fixed', 5, 100) returning id into coupon_min;

  -- ---------- 1) privilégios: só o servidor executa ----------
  total := total + 1;
  if not has_function_privilege('service_role', create_sig, 'EXECUTE')
     or not has_function_privilege('service_role', 'public.validate_coupon(text,text,numeric)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.preview_promotion(text,numeric)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.is_document_eligible(text)', 'EXECUTE') then
    fails := fails || 'service_role perdeu EXECUTE em alguma das quatro funcoes'::text;
  end if;
  total := total + 1;
  if has_function_privilege('anon', create_sig, 'EXECUTE') or has_function_privilege('authenticated', create_sig, 'EXECUTE')
     or has_function_privilege('anon', 'public.validate_coupon(text,text,numeric)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.validate_coupon(text,text,numeric)', 'EXECUTE')
     or has_function_privilege('anon', 'public.preview_promotion(text,numeric)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.preview_promotion(text,numeric)', 'EXECUTE')
     or has_function_privilege('anon', 'public.is_document_eligible(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.is_document_eligible(text)', 'EXECUTE') then
    fails := fails || 'anon/authenticated ainda executam alguma das quatro funcoes'::text;
  end if;
  total := total + 1;
  if has_function_privilege('anon', 'public.create_counter_order(text,text,text,text,jsonb,text,numeric,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.create_counter_order(text,text,text,text,jsonb,text,numeric,text,text)', 'EXECUTE') then
    fails := fails || 'create_counter_order: anon nao deveria executar e authenticated sim'::text;
  end if;
  total := total + 1;
  if has_function_privilege('anon', 'public.guard_online_order_flood()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_online_order_flood()', 'EXECUTE') then
    fails := fails || 'gatilho de retaguarda executavel pela API'::text;
  end if;
  total := total + 1;
  select count(*) into n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_order';
  if n <> 1 then fails := fails || format('create_order deveria ter 1 assinatura (n=%s)', n); end if;
  total := total + 1;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.orders'::regclass and tgname = 'orders_a_flood_guard' and not tgisinternal) then
    fails := fails || 'gatilho orders_a_flood_guard ausente'::text;
  end if;

  -- ---------- 2) chamada direta pela API é recusada (anon, logado sem vínculo, OWNER, STAFF) ----------
  for i in 1..5 loop
    if i = 1 then set local role anon;
    else
      perform set_config('request.jwt.claims', json_build_object('sub',
        case i when 2 then u_stranger when 3 then u_owner_a when 4 then u_staff_a else u_owner_b end, 'role', 'authenticated')::text, true);
      set local role authenticated;
    end if;
    begin
      perform * from public.create_order(slug_a, 'Cliente', '11988887777', 'pickup', 'cash', items_a::jsonb, 'cp-direct-' || i);
      err := 'ok';
    exception when others then err := sqlerrm; end;
    reset role;
    total := total + 1;
    if err not ilike '%permission denied%' then fails := fails || format('2a: create_order direto executou (persona %s: %s)', i, err); end if;

    if i = 1 then set local role anon; else set local role authenticated; end if;
    begin perform * from public.validate_coupon(slug_a, 'UMUSO', 40); err := 'ok'; exception when others then err := sqlerrm; end;
    reset role;
    total := total + 1;
    if err not ilike '%permission denied%' then fails := fails || format('2b: validate_coupon direto executou (persona %s: %s)', i, err); end if;

    if i = 1 then set local role anon; else set local role authenticated; end if;
    begin perform * from public.preview_promotion(slug_a, 40); err := 'ok'; exception when others then err := sqlerrm; end;
    reset role;
    total := total + 1;
    if err not ilike '%permission denied%' then fails := fails || format('2c: preview_promotion direto executou (persona %s: %s)', i, err); end if;

    if i = 1 then set local role anon; else set local role authenticated; end if;
    begin perform public.is_document_eligible('52998224725'); err := 'ok'; exception when others then err := sqlerrm; end;
    reset role;
    total := total + 1;
    if err not ilike '%permission denied%' then fails := fails || format('2d: is_document_eligible direto executou (persona %s: %s)', i, err); end if;
  end loop;
  select count(*) into n from public.orders where restaurant_id = r_a;
  total := total + 1;
  if n <> 0 then fails := fails || format('2e: chamadas diretas deixaram %s pedido(s) gravado(s)', n); end if;

  -- ---------- 3) o caminho do servidor funciona ----------
  set local role service_role;
  select * into o from public.create_order(slug_a, 'Cliente', '11988887777', 'pickup', 'cash', items_a::jsonb, 'cp-ok-1');
  reset role;
  total := total + 1;
  if o.public_id is null or o.order_number <> 1 or o.total <> 40 or o.status <> 'received' then
    fails := fails || format('3a: pedido pelo servidor inesperado (%s)', o);
  end if;

  -- 3b) repetir a MESMA chave devolve o mesmo pedido e não cria outro
  set local role service_role;
  perform * from public.create_order(slug_a, 'Cliente', '11988887777', 'pickup', 'cash', items_a::jsonb, 'cp-ok-1');
  reset role;
  select count(*) into n from public.orders where restaurant_id = r_a and idempotency_key = 'cp-ok-1';
  total := total + 1;
  if n <> 1 then fails := fails || format('3b: chave repetida criou %s pedidos', n); end if;

  -- 3c) o servidor não consegue vender balcão (sem JWT de membro)
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  begin
    perform * from public.create_order(slug_a, 'Balcao', '', 'counter', 'cash', items_a::jsonb, 'cp-counter-svc');
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%not_authenticated%' then fails := fails || format('3c: servidor vendeu balcao sem membro (%s)', err); end if;

  -- 3d) item de OUTRA loja é recusado
  set local role service_role;
  begin
    perform * from public.create_order(slug_a, 'Cliente', '11988887777', 'pickup', 'cash', items_b::jsonb, 'cp-cross-1');
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%product_not_found%' then fails := fails || format('3d: produto de outra loja aceito (%s)', err); end if;

  -- 3e) loja fechada e loja inexistente
  set local role service_role;
  begin
    perform * from public.create_order(slug_c, 'Cliente', '11988887777', 'pickup', 'cash',
      jsonb_build_array(jsonb_build_object('product_id', prod_c, 'quantity', 1)), 'cp-closed-1');
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%restaurant_closed%' then fails := fails || format('3e: loja fora do horario aceitou pedido (%s)', err); end if;
  set local role service_role;
  begin
    perform * from public.create_order('nao-existe-xyz', 'Cliente', '11988887777', 'pickup', 'cash', items_a::jsonb, 'cp-nf-1');
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%restaurant_not_found%' then fails := fails || format('3e2: loja inexistente (%s)', err); end if;

  -- ---------- 4) cupom ----------
  set local role service_role;
  select count(*) into n from public.validate_coupon(slug_a, 'UMUSO', 40);
  reset role;
  select uses_count into v_uses from public.coupons where id = coupon_one;
  total := total + 1;
  if n <> 1 or v_uses <> 0 then fails := fails || format('4a: validar cupom consumiu uso (linhas=%s usos=%s)', n, v_uses); end if;

  -- 4b) pedido recusado por outro motivo NAO consome o cupom (minimo do cupom nao atingido)
  set local role service_role;
  begin
    perform * from public.create_order(slug_a, 'Cliente', '11988887777', 'pickup', 'cash', items_a::jsonb, 'cp-cup-min', null, null, null, null, null, null, null, null, null, null, null, 'MIN100');
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%coupon_below_minimum_order%' then fails := fails || format('4b: cupom abaixo do minimo aceito (%s)', err); end if;

  -- 4c) primeiro pedido com UMUSO consome; repetir a mesma chave NAO consome de novo
  set local role service_role;
  perform * from public.create_order(slug_a, 'Cliente', '11977776666', 'pickup', 'cash', items_a::jsonb, 'cp-cup-1', null, null, null, null, null, null, null, null, null, null, null, 'UMUSO');
  perform * from public.create_order(slug_a, 'Cliente', '11977776666', 'pickup', 'cash', items_a::jsonb, 'cp-cup-1', null, null, null, null, null, null, null, null, null, null, null, 'UMUSO');
  reset role;
  select uses_count into v_uses from public.coupons where id = coupon_one;
  total := total + 1;
  if v_uses <> 1 then fails := fails || format('4c: cupom de 1 uso com usos=%s apos pedido + repeticao', v_uses); end if;
  select * into o from public.orders where restaurant_id = r_a and idempotency_key = 'cp-cup-1';
  total := total + 1;
  if o.discount_amount <> 5 or o.total <> 35 then fails := fails || format('4c2: desconto inesperado (%s / %s)', o.discount_amount, o.total); end if;

  -- 4d) outra chave com o mesmo cupom: limite de usos barra
  set local role service_role;
  begin
    perform * from public.create_order(slug_a, 'Cliente', '11966665555', 'pickup', 'cash', items_a::jsonb, 'cp-cup-2', null, null, null, null, null, null, null, null, null, null, null, 'UMUSO');
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  select uses_count into v_uses from public.coupons where id = coupon_one;
  total := total + 1;
  if err not ilike '%coupon_usage_limit_reached%' or v_uses <> 1 then fails := fails || format('4d: limite de usos do cupom nao barrou (%s, usos=%s)', err, v_uses); end if;

  -- 4e) cupom da loja A NAO vale na loja B
  set local role service_role;
  begin
    perform * from public.create_order(slug_b, 'Cliente', '11955554444', 'pickup', 'cash', items_b::jsonb, 'cp-cup-b', null, null, null, null, null, null, null, null, null, null, null, 'UMUSO');
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%coupon_not_found%' then fails := fails || format('4e: cupom de outra loja aceito (%s)', err); end if;

  -- ---------- 5) venda de balcão: só membro, OWNER e STAFF ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_staff_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform * from public.create_counter_order(slug_a, 'Balcao', '', 'cash', items_a::jsonb, 'cp-bal-staff');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform * from public.create_counter_order(slug_a, 'Balcao', '', 'cash', items_a::jsonb, 'cp-bal-owner');
  -- repetir a chave: mesmo pedido
  perform * from public.create_counter_order(slug_a, 'Balcao', '', 'cash', items_a::jsonb, 'cp-bal-owner');
  reset role;
  select count(*) into n from public.orders where restaurant_id = r_a and fulfillment_type = 'counter' and idempotency_key in ('cp-bal-staff', 'cp-bal-owner');
  total := total + 1;
  if n <> 2 then fails := fails || format('5a: vendas de balcao de STAFF e OWNER (esperado 2, obtido %s)', n); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform * from public.create_counter_order(slug_a, 'Balcao', '', 'cash', items_a::jsonb, 'cp-bal-x'); err := 'ok'; exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%not_authorized%' then fails := fails || format('5b: OWNER da loja B vendeu na loja A (%s)', err); end if;

  -- ---------- 6) retaguarda no banco: telefone ----------
  -- o telefone 11988887777 ja tem 1 pedido (3a). Mais 9 (formatos diferentes do mesmo numero) = 10; o 11o e barrado.
  set local role service_role;
  for i in 1..9 loop
    perform * from public.create_order(slug_a, 'Cliente', case i % 3 when 0 then '(11) 98888-7777' when 1 then '11988887777' else '11 98888 7777' end,
      'pickup', 'cash', items_a::jsonb, 'cp-fone-' || i);
  end loop;
  begin
    perform * from public.create_order(slug_a, 'Cliente', '(11) 9 8888-7777', 'pickup', 'cash', items_a::jsonb, 'cp-fone-11');
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%order_rate_limited%' then fails := fails || format('6a: 11o pedido do mesmo telefone nao foi barrado (%s)', err); end if;
  select count(*) into n from public.orders where restaurant_id = r_a and idempotency_key = 'cp-fone-11';
  total := total + 1;
  if n <> 0 then fails := fails || '6b: pedido barrado deixou linha gravada'::text; end if;

  -- 6c) outro telefone na mesma loja e o mesmo telefone em outra loja seguem aceitos
  set local role service_role;
  perform * from public.create_order(slug_a, 'Cliente', '11944443333', 'pickup', 'cash', items_a::jsonb, 'cp-fone-outro');
  perform * from public.create_order(slug_b, 'Cliente', '11988887777', 'pickup', 'cash', items_b::jsonb, 'cp-fone-lojab');
  reset role;
  select count(*) into n from public.orders where idempotency_key in ('cp-fone-outro', 'cp-fone-lojab');
  total := total + 1;
  if n <> 2 then fails := fails || format('6c: outro telefone/outra loja deveriam passar (n=%s)', n); end if;

  -- 6d) a janela expira: pedidos com mais de 10 minutos saem da conta
  update public.orders set created_at = now() - interval '11 minutes' where restaurant_id = r_a and fulfillment_type <> 'counter';
  set local role service_role;
  perform * from public.create_order(slug_a, 'Cliente', '11988887777', 'pickup', 'cash', items_a::jsonb, 'cp-fone-depois');
  reset role;
  select count(*) into n from public.orders where restaurant_id = r_a and idempotency_key = 'cp-fone-depois';
  total := total + 1;
  if n <> 1 then fails := fails || '6d: depois da janela o telefone deveria voltar a ser aceito'::text; end if;

  -- ---------- 7) retaguarda no banco: loja inteira ----------
  update public.orders set created_at = now() - interval '11 minutes' where restaurant_id = r_a;
  set local role service_role;
  for i in 1..300 loop
    perform * from public.create_order(slug_a, 'Cliente', '11' || lpad((900000000 + i)::text, 9, '0'),
      'pickup', 'cash', items_a::jsonb, 'cp-flood-' || i);
  end loop;
  begin
    perform * from public.create_order(slug_a, 'Cliente', '11899990000', 'pickup', 'cash', items_a::jsonb, 'cp-flood-301');
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%order_rate_limited%' then fails := fails || format('7a: pedido 301 da loja em 10 min nao foi barrado (%s)', err); end if;

  -- 7b) a venda de balcão não é afetada; 7c) outra loja não é afetada
  perform set_config('request.jwt.claims', json_build_object('sub', u_staff_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform * from public.create_counter_order(slug_a, 'Balcao', '', 'cash', items_a::jsonb, 'cp-flood-balcao');
  reset role;
  select count(*) into n from public.orders where restaurant_id = r_a and idempotency_key = 'cp-flood-balcao';
  total := total + 1;
  if n <> 1 then fails := fails || '7b: balcao foi barrado pela retaguarda de pedidos online'::text; end if;
  set local role service_role;
  perform * from public.create_order(slug_b, 'Cliente', '11777776666', 'pickup', 'cash', items_b::jsonb, 'cp-flood-lojab');
  reset role;
  select count(*) into n from public.orders where restaurant_id = r_b and idempotency_key = 'cp-flood-lojab';
  total := total + 1;
  if n <> 1 then fails := fails || '7c: a rajada na loja A afetou a loja B'::text; end if;

  -- 7d) repetir uma chave já gravada durante a rajada continua devolvendo o pedido (idempotência não é barrada)
  set local role service_role;
  select * into o from public.create_order(slug_a, 'Cliente', '11' || lpad((900000000 + 5)::text, 9, '0'), 'pickup', 'cash', items_a::jsonb, 'cp-flood-5');
  reset role;
  total := total + 1;
  if o.public_id is null then fails := fails || '7d: repeticao de chave durante a rajada nao devolveu o pedido'::text; end if;

  -- ---------- 8) elegibilidade de documento pelo servidor ----------
  set local role service_role;
  select public.is_document_eligible('52998224725')::text into err;
  reset role;
  total := total + 1;
  if err <> 'true' then fails := fails || format('8a: documento livre deveria ser elegivel (%s)', err); end if;
  set local role service_role;
  select public.is_document_eligible('12345678062')::text into err;   -- ja usado por u_owner_a
  reset role;
  total := total + 1;
  if err <> 'false' then fails := fails || format('8b: documento ja usado deveria ser inelegivel (%s)', err); end if;

  -- ---------- relatório ----------
  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes', total;
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %', array_length(fails, 1), total, array_to_string(fails, ' ## ');
  end if;
end $$;
