-- MenuNext — teste de regressão: variantes de produto (cadastro, preço e disponibilidade por variante).
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO. Tudo num bloco que SEMPRE termina com `raise exception` (nada persiste).
-- Resultado: a mensagem final do erro ("RESULTADO: OK | N verificacoes" ou "FALHOU").
--
-- Regras testadas: OWNER cria/edita/apaga na própria loja; STAFF só liga/desliga disponibilidade; outra loja,
-- estranho e visitante nada; nomes únicos por produto, sem diferença de caixa (testado em ASCII: o laboratório usa locale C, onde lower() não trata acentos); preço e nome validados; limite de 20;
-- leitura de membros (visitante só de loja publicada); sem escrita direta; cascata ao apagar o produto; create_order e preço do produto intactos.

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
  r_a uuid; r_b uuid; cat_a uuid; cat_b uuid; pa uuid; pa2 uuid; pb uuid; v1 uuid; v2 uuid; vb uuid; i int;
  res text;
  fails text[] := '{}'; total int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_owner_a, 'owner-a@pv.test', jsonb_build_object('name','Dona A','phone','11999990001','document','12345678062')),
    (u_staff_a, 'staff-a@pv.test', jsonb_build_object('name','Equipe A','phone','11999990002','document','98765432029')),
    (u_owner_b, 'owner-b@pv.test', jsonb_build_object('name','Dono B','phone','11999990003','document','24681357090')),
    (u_stranger,'stranger@pv.test',jsonb_build_object('name','Estranho','phone','11999990005','document','86420975310'));
  update public.profiles set trial_ends_at = now() + interval '30 days' where user_id in (u_owner_a, u_owner_b);
  insert into public.restaurants (name, slug) values ('Loja A', 'pv-a') returning id into r_a;
  insert into public.restaurants (name, slug) values ('Loja B', 'pv-b') returning id into r_b;
  insert into public.restaurant_members (restaurant_id, user_id, role) values
    (r_a, u_owner_a, 'OWNER'), (r_a, u_staff_a, 'STAFF'), (r_b, u_owner_b, 'OWNER');
  insert into public.categories (restaurant_id, name, display_order) values (r_a, 'c', 1) returning id into cat_a;
  insert into public.categories (restaurant_id, name, display_order) values (r_b, 'c', 1) returning id into cat_b;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_a, 'Pizza', 40, cat_a, 1) returning id into pa;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_a, 'Suco', 8, cat_a, 2) returning id into pa2;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_b, 'Pizza B', 50, cat_b, 1) returning id into pb;

  -- ---------- 0) catálogo ----------
  total := total + 1;
  if not exists (select 1 from pg_class where oid = 'public.product_variants'::regclass and relrowsecurity) then fails := fails || 'product_variants sem RLS'::text; end if;
  total := total + 1;
  -- anon SELECT: a loja publica le as variantes desde 20261108000000 (a RLS restringe a loja publicada; ver order_item_variants.sql)
  if has_table_privilege('anon','public.product_variants','INSERT') or has_table_privilege('authenticated','public.product_variants','INSERT')
     or has_table_privilege('authenticated','public.product_variants','UPDATE') or has_table_privilege('authenticated','public.product_variants','DELETE')
     or not has_table_privilege('authenticated','public.product_variants','SELECT') then
    fails := fails || 'privilegios de tabela incorretos'::text;
  end if;
  total := total + 1;
  if has_function_privilege('anon','public.product_variant_create(uuid,text,numeric,boolean)','EXECUTE')
     or not has_function_privilege('authenticated','public.product_variant_set_available(uuid,boolean)','EXECUTE') then
    fails := fails || 'privilegios de EXECUTE incorretos'::text;
  end if;

  -- ---------- 1) OWNER cria ----------
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.product_variant_create(%L, ''  Média '', 55.5)::text', pa));
  total := total + 1;
  if res like 'ERR:%' then fails := fails || format('OWNER nao criou variante (%s)', res); else v1 := res::uuid; end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.product_variant_create(%L, ''Grande'', 70, false)::text', pa));
  v2 := res::uuid;
  total := total + 1;
  if not exists (select 1 from public.product_variants where id = v1 and name = 'Média' and price = 55.50 and is_available and display_order = 1 and restaurant_id = r_a)
     or not exists (select 1 from public.product_variants where id = v2 and not is_available and display_order = 2) then
    fails := fails || 'variantes gravadas com nome/preco/ordem/disponibilidade incorretos'::text;
  end if;
  total := total + 1;
  if (select price from public.products where id = pa) <> 40 then fails := fails || 'criar variante alterou o preco do produto'::text; end if;

  -- ---------- 2) validações ----------
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.product_variant_create(%L, ''GRANDE'', 10)::text', pa));
  total := total + 1;
  if res not ilike '%variant_duplicate%' then fails := fails || format('nome duplicado (sem caixa) deveria ser recusado (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.product_variant_create(%L, ''Média'', 10)::text', pa2));
  total := total + 1;
  if res like 'ERR:%' then fails := fails || format('mesmo nome em outro produto deveria passar (%s)', res); end if;
  for i in 1..3 loop
    res := pg_temp._runas('authenticated', u_owner_a, format('select public.product_variant_create(%L, %L, %s)::text', pa2, 'x', (array['0','-1','100000'])[i]));
    total := total + 1;
    if res not ilike '%invalid_price%' then fails := fails || format('preco invalido %s (%s)', (array['0','-1','100000'])[i], res); end if;
  end loop;
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.product_variant_create(%L, ''Y'', null)::text', pa2));
  total := total + 1;
  if res not ilike '%invalid_price%' then fails := fails || format('preco nulo (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.product_variant_create(%L, ''   '', 10)::text', pa2));
  total := total + 1;
  if res not ilike '%invalid_name%' then fails := fails || format('nome vazio (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.product_variant_create(%L, %L, 10)::text', pa2, repeat('n', 61)));
  total := total + 1;
  if res not ilike '%invalid_name%' then fails := fails || format('nome longo (%s)', res); end if;

  -- ---------- 3) permissões de escrita ----------
  res := pg_temp._runas('authenticated', u_staff_a, format('select public.product_variant_create(%L, ''Mini'', 5)::text', pa));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('STAFF criou variante (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, format('select public.product_variant_update(%L, ''X'', 1, true)::text', v1));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('STAFF editou variante (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, format('select public.product_variant_delete(%L)::text', v1));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('STAFF apagou variante (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, format('select public.product_variant_create(%L, ''Invasao'', 5)::text', pa));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('OWNER B criou variante em produto da loja A (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, format('select public.product_variant_update(%L, ''X'', 1, true)::text', v1));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('OWNER B editou variante da loja A (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, format('select public.product_variant_set_available(%L, false)::text', v1));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('OWNER B mexeu na disponibilidade da loja A (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, format('select public.product_variant_delete(%L)::text', v1));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('OWNER B apagou variante da loja A (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_stranger, format('select public.product_variant_set_available(%L, false)::text', v1));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('estranho mexeu na disponibilidade (%s)', res); end if;
  res := pg_temp._runas('anon', null, format('select public.product_variant_set_available(%L, false)::text', v1));
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('visitante executou funcao de variante (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.product_variant_update(%L, ''X'', 1, true)::text', gen_random_uuid()));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('variante inexistente (%s)', res); end if;
  total := total + 1;
  if not exists (select 1 from public.product_variants where id = v1 and name = 'Média' and price = 55.50) then fails := fails || 'tentativas nao autorizadas alteraram a variante'::text; end if;

  -- ---------- 4) STAFF liga/desliga; OWNER edita ----------
  res := pg_temp._runas('authenticated', u_staff_a, format('select public.product_variant_set_available(%L, false)::text', v1));
  total := total + 1;
  if res like 'ERR:%' or (select is_available from public.product_variants where id = v1) then fails := fails || format('STAFF nao desligou a disponibilidade (%s)', res); end if;
  total := total + 1;
  if (select name || price::text from public.product_variants where id = v1) <> 'Média55.50' then fails := fails || 'desligar disponibilidade alterou nome/preco'::text; end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.product_variant_update(%L, ''Média Plus'', 59.9, true)::text', v1));
  total := total + 1;
  if res like 'ERR:%' or not exists (select 1 from public.product_variants where id = v1 and name = 'Média Plus' and price = 59.90 and is_available) then fails := fails || format('OWNER nao editou (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.product_variant_update(%L, ''grande'', 59.9, true)::text', v1));
  total := total + 1;
  if res not ilike '%variant_duplicate%' then fails := fails || format('renomear para nome existente (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.product_variant_update(%L, ''Média Plus'', 59.9, null)::text', v1));
  total := total + 1;
  if res not ilike '%invalid_value%' then fails := fails || format('disponibilidade nula (%s)', res); end if;

  -- ---------- 5) leitura ----------
  res := pg_temp._runas('authenticated', u_staff_a, 'select count(*)::text from public.product_variants');
  total := total + 1;
  if res <> '3' then fails := fails || format('STAFF deveria ler as 3 variantes da loja (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, 'select count(*)::text from public.product_variants');
  total := total + 1;
  if res <> '0' then fails := fails || format('OWNER B leu variantes da loja A (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_stranger, 'select count(*)::text from public.product_variants');
  total := total + 1;
  if res <> '0' then fails := fails || format('estranho leu variantes (%s)', res); end if;
  -- lojas deste teste NAO estao publicadas: o visitante nao ve nada (a leitura publica de loja publicada e testada em order_item_variants.sql)
  res := pg_temp._runas('anon', null, 'select count(*)::text from public.product_variants');
  total := total + 1;
  if res <> '0' then fails := fails || format('visitante leu variantes de loja nao publicada (%s)', res); end if;

  -- ---------- 6) sem escrita direta ----------
  res := pg_temp._runas('authenticated', u_owner_a, format('update public.product_variants set price = 1 where id = %L returning 1', v1));
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('OWNER atualizou direto (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('insert into public.product_variants (product_id, restaurant_id, name, price) values (%L, %L, ''Direta'', 1) returning 1', pa, r_a));
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('OWNER inseriu direto (%s)', res); end if;

  -- ---------- 7) limite de 20 por produto ----------
  for i in 1..17 loop
    perform pg_temp._runas('authenticated', u_owner_a, format('select public.product_variant_create(%L, %L, 5)::text', pa, 'v' || i));
  end loop;
  total := total + 1;
  if (select count(*) from public.product_variants where product_id = pa) <> 19 then fails := fails || 'deveriam existir 19 variantes'::text; end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.product_variant_create(%L, ''v20'', 5)::text', pa));
  total := total + 1;
  if res like 'ERR:%' then fails := fails || format('a 20a variante deveria passar (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.product_variant_create(%L, ''v21'', 5)::text', pa));
  total := total + 1;
  if res not ilike '%too_many_variants%' then fails := fails || format('a 21a variante deveria ser recusada (%s)', res); end if;

  -- ---------- 8) apagar e cascata ----------
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.product_variant_delete(%L)::text', v2));
  total := total + 1;
  if res like 'ERR:%' or exists (select 1 from public.product_variants where id = v2) then fails := fails || format('OWNER nao apagou (%s)', res); end if;
  delete from public.products where id = pa;
  total := total + 1;
  if exists (select 1 from public.product_variants where product_id = pa) then fails := fails || 'variantes sobraram apos apagar o produto'::text; end if;
  total := total + 1;
  if (select price from public.products where id = pb) <> 50 then fails := fails || 'produto da loja B alterado'::text; end if;

  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes', total;
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %', array_length(fails, 1), total, array_to_string(fails, ' ## ');
  end if;
end $$;
