-- MenuNext — teste de regressão: estoque integrado aos pedidos (baixa na venda, estorno no cancelamento).
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO. Tudo acontece num bloco que SEMPRE termina com `raise exception`
-- (nada persiste). Resultado: a mensagem final do erro ("RESULTADO: OK | N verificacoes" ou "FALHOU").
--
-- Regras testadas: desligado por padrão (nada muda); só o OWNER liga; baixa por item do pedido; idempotência (repetir a
-- baixa/estorno não duplica); produto sem controle e produto apagado ignorados; venda acima do saldo baixa só até
-- zero e o estorno devolve só o que saiu; cancelamento estorna uma única vez; pedido cancelado não baixa; isolamento
-- entre lojas; falha no estoque não derruba o pedido; livro soma o saldo; funções internas fechadas.

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
  r_a uuid; r_b uuid; cat_a uuid; cat_b uuid;
  p1 uuid; p2 uuid; p3 uuid; pb uuid;
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; ob uuid;
  i1 uuid; i2 uuid; i3 uuid; i4 uuid; i5 uuid; ib uuid;
  res text; n int; seq int := 0;
  fails text[] := '{}'; total int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_owner_a, 'owner-a@so.test', jsonb_build_object('name','Dona A','phone','11999990001','document','12345678062')),
    (u_staff_a, 'staff-a@so.test', jsonb_build_object('name','Equipe A','phone','11999990002','document','98765432029')),
    (u_owner_b, 'owner-b@so.test', jsonb_build_object('name','Dono B','phone','11999990003','document','24681357090'));
  update public.profiles set trial_ends_at = now() + interval '30 days' where user_id in (u_owner_a, u_owner_b);
  insert into public.restaurants (name, slug) values ('Loja A', 'so-a') returning id into r_a;
  insert into public.restaurants (name, slug) values ('Loja B', 'so-b') returning id into r_b;
  insert into public.restaurant_members (restaurant_id, user_id, role) values
    (r_a, u_owner_a, 'OWNER'), (r_a, u_staff_a, 'STAFF'), (r_b, u_owner_b, 'OWNER');
  insert into public.categories (restaurant_id, name, display_order) values (r_a, 'c', 1) returning id into cat_a;
  insert into public.categories (restaurant_id, name, display_order) values (r_b, 'c', 1) returning id into cat_b;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_a, 'p1', 10, cat_a, 1) returning id into p1;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_a, 'p2-sem-controle', 10, cat_a, 2) returning id into p2;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_a, 'p3', 10, cat_a, 3) returning id into p3;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_b, 'pb', 10, cat_b, 1) returning id into pb;

  perform pg_temp._runas('authenticated', u_owner_a, format('select quantity::text from public.stock_record_movement(%L, ''entry'', 10)', p1));
  perform pg_temp._runas('authenticated', u_owner_a, format('select quantity::text from public.stock_record_movement(%L, ''entry'', 2)', p3));
  perform pg_temp._runas('authenticated', u_owner_b, format('select quantity::text from public.stock_record_movement(%L, ''entry'', 20)', pb));

  -- ---------- 0) catálogo ----------
  total := total + 1;
  if has_function_privilege('authenticated','public._stock_consume_item(uuid)','EXECUTE') or has_function_privilege('anon','public._stock_consume_item(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public._stock_restore_item(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public._stock_trg_order_item()','EXECUTE')
     or has_function_privilege('anon','public.stock_set_auto_deduct(boolean)','EXECUTE')
     or not has_function_privilege('authenticated','public.stock_set_auto_deduct(boolean)','EXECUTE') then
    fails := fails || 'privilegios de EXECUTE incorretos nas funcoes de integracao'::text;
  end if;
  total := total + 1;
  if has_table_privilege('authenticated','public.stock_settings','INSERT') or has_table_privilege('authenticated','public.stock_settings','UPDATE')
     or has_table_privilege('anon','public.stock_settings','SELECT') or not has_table_privilege('authenticated','public.stock_settings','SELECT') then
    fails := fails || 'privilegios de stock_settings incorretos'::text;
  end if;

  -- ---------- 1) desligado por padrão: nada muda ----------
  insert into public.orders (restaurant_id, order_number, customer_name, customer_phone, fulfillment_type, payment_method, subtotal, total, status, idempotency_key)
  values (r_a, 1, 'c', '11999990001', 'pickup', 'cash', 30, 30, 'received', 'so-1') returning id into o1;
  insert into public.order_items (restaurant_id, order_id, product_id, product_name, unit_price, quantity, subtotal)
  values (r_a, o1, p1, 'p1', 10, 3, 30) returning id into i1;
  total := total + 1;
  if (select quantity from public.stock_items where product_id = p1) <> 10 or exists (select 1 from public.stock_movements where kind = 'sale') then
    fails := fails || 'com a baixa desligada o estoque mudou'::text;
  end if;

  -- ---------- 2) quem liga ----------
  res := pg_temp._runas('authenticated', u_staff_a, 'select public.stock_set_auto_deduct(true)::text');
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('STAFF ligou a baixa automatica (%s)', res); end if;
  res := pg_temp._runas('anon', null, 'select public.stock_set_auto_deduct(true)::text');
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('visitante ligou a baixa (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, 'select public.stock_set_auto_deduct(null)::text');
  total := total + 1;
  if res not ilike '%invalid_value%' then fails := fails || format('valor nulo (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, 'select public.stock_set_auto_deduct(true)::text');
  total := total + 1;
  if res <> 'true' or not (select auto_deduct from public.stock_settings where restaurant_id = r_a) then fails := fails || format('OWNER nao ligou (%s)', res); end if;
  total := total + 1;
  if exists (select 1 from public.stock_settings where restaurant_id = r_b) then fails := fails || 'ligar na loja A mexeu na loja B'::text; end if;
  res := pg_temp._runas('authenticated', u_staff_a, 'select count(*)::text from public.stock_settings');
  total := total + 1;
  if res <> '1' then fails := fails || format('STAFF deveria ler a configuracao da propria loja (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, 'select count(*)::text from public.stock_settings');
  total := total + 1;
  if res <> '0' then fails := fails || format('OWNER B leu configuracao da loja A (%s)', res); end if;

  -- item antigo (pedido já existente) não é baixado retroativamente
  total := total + 1;
  if (select quantity from public.stock_items where product_id = p1) <> 10 then fails := fails || 'ligar a baixa nao deve baixar pedidos antigos'::text; end if;

  -- ---------- 3) baixa por item ----------
  insert into public.orders (restaurant_id, order_number, customer_name, customer_phone, fulfillment_type, payment_method, subtotal, total, status, idempotency_key)
  values (r_a, 2, 'c', '11999990001', 'pickup', 'cash', 50, 50, 'received', 'so-2') returning id into o2;
  insert into public.order_items (restaurant_id, order_id, product_id, product_name, unit_price, quantity, subtotal)
  values (r_a, o2, p1, 'p1', 10, 3, 30) returning id into i2;
  insert into public.order_items (restaurant_id, order_id, product_id, product_name, unit_price, quantity, subtotal)
  values (r_a, o2, p1, 'p1', 10, 1, 10) returning id into i3;
  insert into public.order_items (restaurant_id, order_id, product_id, product_name, unit_price, quantity, subtotal)
  values (r_a, o2, p2, 'p2', 10, 1, 10) returning id into i4;
  total := total + 1;
  if (select quantity from public.stock_items where product_id = p1) <> 6 then fails := fails || format('duas linhas do mesmo produto deveriam baixar 3+1 (saldo %s)', (select quantity from public.stock_items where product_id = p1)); end if;
  total := total + 1;
  if not exists (select 1 from public.stock_movements where order_item_id = i2 and kind = 'sale' and delta = -3 and balance_after = 7)
     or not exists (select 1 from public.stock_movements where order_item_id = i3 and kind = 'sale' and delta = -1 and balance_after = 6) then
    fails := fails || 'movimentos de venda com delta/saldo incorretos'::text;
  end if;
  total := total + 1;
  if exists (select 1 from public.stock_items where product_id = p2) or exists (select 1 from public.stock_movements where product_id = p2) then
    fails := fails || 'produto sem controle de estoque foi tocado'::text;
  end if;

  -- ---------- 4) idempotência ----------
  total := total + 1;
  if public._stock_consume_item(i2) is distinct from false or public._stock_consume_item(i3) is distinct from false then
    fails := fails || 'repetir a baixa deveria ser no-op'::text;
  end if;
  total := total + 1;
  if (select quantity from public.stock_items where product_id = p1) <> 6 or (select count(*) from public.stock_movements where kind = 'sale' and product_id = p1) <> 2 then
    fails := fails || 'baixa duplicada alterou saldo ou livro'::text;
  end if;
  begin
    insert into public.stock_movements (restaurant_id, product_id, kind, delta, balance_after, order_item_id) values (r_a, p1, 'sale', -1, 5, i2);
    fails := fails || 'indice unico nao impediu segunda baixa do mesmo item'::text;
  exception when unique_violation then null; end;
  total := total + 1;

  -- ---------- 5) venda acima do saldo ----------
  insert into public.orders (restaurant_id, order_number, customer_name, customer_phone, fulfillment_type, payment_method, subtotal, total, status, idempotency_key)
  values (r_a, 3, 'c', '11999990001', 'pickup', 'cash', 50, 50, 'received', 'so-3') returning id into o3;
  insert into public.order_items (restaurant_id, order_id, product_id, product_name, unit_price, quantity, subtotal)
  values (r_a, o3, p3, 'p3', 10, 5, 50) returning id into i5;
  total := total + 1;
  if (select quantity from public.stock_items where product_id = p3) <> 0
     or not exists (select 1 from public.stock_movements where order_item_id = i5 and delta = -2 and note = 'venda acima do saldo') then
    fails := fails || 'venda acima do saldo deveria baixar so ate zero e anotar'::text;
  end if;

  -- ---------- 6) cancelamento estorna uma vez ----------
  update public.orders set status = 'cancelled' where id = o2;
  total := total + 1;
  if (select quantity from public.stock_items where product_id = p1) <> 10 then fails := fails || format('cancelar deveria devolver 4 (saldo %s)', (select quantity from public.stock_items where product_id = p1)); end if;
  total := total + 1;
  if (select count(*) from public.stock_movements where kind = 'sale_reversal' and product_id = p1) <> 2 then fails := fails || 'deveria haver 2 estornos'::text; end if;
  update public.orders set status = 'cancelled', observation = 'de novo' where id = o2;
  total := total + 1;
  if public._stock_restore_item(i2) is distinct from false or (select quantity from public.stock_items where product_id = p1) <> 10
     or (select count(*) from public.stock_movements where kind = 'sale_reversal' and product_id = p1) <> 2 then
    fails := fails || 'estorno repetido duplicou'::text;
  end if;
  update public.orders set status = 'cancelled' where id = o3;
  total := total + 1;
  if (select quantity from public.stock_items where product_id = p3) <> 2 then fails := fails || format('estorno deveria devolver so os 2 que sairam (saldo %s)', (select quantity from public.stock_items where product_id = p3)); end if;

  -- ---------- 7) item em pedido já cancelado / produto apagado ----------
  insert into public.orders (restaurant_id, order_number, customer_name, customer_phone, fulfillment_type, payment_method, subtotal, total, status, idempotency_key)
  values (r_a, 4, 'c', '11999990001', 'pickup', 'cash', 10, 10, 'cancelled', 'so-4') returning id into o4;
  insert into public.order_items (restaurant_id, order_id, product_id, product_name, unit_price, quantity, subtotal)
  values (r_a, o4, p1, 'p1', 10, 5, 50);
  total := total + 1;
  if (select quantity from public.stock_items where product_id = p1) <> 10 then fails := fails || 'item de pedido cancelado baixou estoque'::text; end if;
  begin
    insert into public.orders (restaurant_id, order_number, customer_name, customer_phone, fulfillment_type, payment_method, subtotal, total, status, idempotency_key)
    values (r_a, 5, 'c', '11999990001', 'pickup', 'cash', 10, 10, 'received', 'so-5') returning id into o4;
    insert into public.order_items (restaurant_id, order_id, product_id, product_name, unit_price, quantity, subtotal)
    values (r_a, o4, null, 'produto apagado', 10, 1, 10);
    n := 1;
  exception when others then n := 0; end;
  total := total + 1;
  if n <> 1 then fails := fails || 'item sem product_id quebrou a insercao'::text; end if;

  -- ---------- 8) isolamento entre lojas ----------
  insert into public.orders (restaurant_id, order_number, customer_name, customer_phone, fulfillment_type, payment_method, subtotal, total, status, idempotency_key)
  values (r_b, 1, 'c', '11999990003', 'pickup', 'cash', 10, 10, 'received', 'so-b1') returning id into ob;
  insert into public.order_items (restaurant_id, order_id, product_id, product_name, unit_price, quantity, subtotal)
  values (r_b, ob, pb, 'pb', 10, 4, 40);
  total := total + 1;
  if (select quantity from public.stock_items where product_id = pb) <> 20 then fails := fails || 'loja B com baixa desligada foi baixada pela configuracao da loja A'::text; end if;
  perform pg_temp._runas('authenticated', u_owner_b, 'select public.stock_set_auto_deduct(true)::text');
  insert into public.order_items (restaurant_id, order_id, product_id, product_name, unit_price, quantity, subtotal)
  values (r_b, ob, pb, 'pb', 10, 4, 40) returning id into ib;
  total := total + 1;
  if (select quantity from public.stock_items where product_id = pb) <> 16 or (select quantity from public.stock_items where product_id = p1) <> 10 then
    fails := fails || 'a baixa da loja B deveria afetar so a loja B'::text;
  end if;
  -- item da loja A apontando para produto da loja B (dado corrompido) não baixa a loja B
  insert into public.order_items (restaurant_id, order_id, product_id, product_name, unit_price, quantity, subtotal)
  values (r_a, o1, pb, 'pb', 10, 1, 10);
  total := total + 1;
  if (select quantity from public.stock_items where product_id = pb) <> 16 then fails := fails || 'item da loja A baixou estoque da loja B'::text; end if;

  -- ---------- 9) falha no estoque não derruba o pedido ----------
  create function pg_temp._boom() returns trigger language plpgsql as $f$ begin raise exception 'boom'; end $f$;
  create trigger _boom before insert on public.stock_movements for each row execute function pg_temp._boom();
  begin
    insert into public.order_items (restaurant_id, order_id, product_id, product_name, unit_price, quantity, subtotal)
    values (r_a, o1, p1, 'p1', 10, 1, 10);
    n := 1;
  exception when others then n := 0; end;
  drop trigger _boom on public.stock_movements;
  total := total + 1;
  if n <> 1 then fails := fails || 'falha do estoque derrubou a insercao do item'::text; end if;
  total := total + 1;
  if (select quantity from public.stock_items where product_id = p1) <> 10 then fails := fails || 'falha do estoque deixou saldo pela metade'::text; end if;

  -- ---------- 10) livro soma o saldo; leitura por membros ----------
  total := total + 1;
  if (select sum(delta) from public.stock_movements where product_id = p1) is distinct from (select quantity from public.stock_items where product_id = p1)::bigint then
    fails := fails || 'soma do livro difere do saldo (p1)'::text;
  end if;
  total := total + 1;
  if (select sum(delta) from public.stock_movements where product_id = p3) is distinct from (select quantity from public.stock_items where product_id = p3)::bigint then
    fails := fails || 'soma do livro difere do saldo (p3)'::text;
  end if;
  res := pg_temp._runas('authenticated', u_staff_a, 'select count(*)::text from public.stock_movements where kind in (''sale'',''sale_reversal'')');
  total := total + 1;
  if res <> '6' then fails := fails || format('STAFF deveria ler as 6 movimentacoes de venda/estorno da loja (%s)', res); end if;

  -- ---------- 11) apagar pedido não é bloqueado pelo livro ----------
  begin
    delete from public.orders where id = o2;
    n := 1;
  exception when others then n := 0; end;
  total := total + 1;
  if n <> 1 then fails := fails || 'apagar pedido com movimentos de estoque falhou'::text; end if;
  total := total + 1;
  if exists (select 1 from public.stock_movements where order_item_id = i2) or (select count(*) from public.stock_movements where product_id = p1 and kind = 'sale') < 1 then
    fails := fails || 'movimentos deveriam ficar com order_item_id nulo apos apagar o pedido'::text;
  end if;

  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes', total;
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %', array_length(fails, 1), total, array_to_string(fails, ' ## ');
  end if;
end $$;
