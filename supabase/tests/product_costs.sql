-- MenuNext — teste de regressão: custo dos produtos em tabela própria (product_costs).
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO (local ou branch). Cria usuários e lojas de teste; tudo fica
-- numa transação que SEMPRE termina com `raise exception` (nada persiste).
-- Resultado: a mensagem final do erro é o relatório ("RESULTADO: OK | N verificacoes" ou "FALHOU").
--
-- Regras testadas: o custo só é gravado por create_product/update_product (OWNER); só membros da própria
-- loja leem; visitante e outra loja não leem nem escrevem; ninguém escreve direto na tabela; apagar o
-- produto apaga o custo; custo negativo é recusado; products.cost deixa de ser escrito.

do $$
declare
  u_owner_a uuid := gen_random_uuid();
  u_staff_a uuid := gen_random_uuid();
  u_owner_b uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  r_a uuid; r_b uuid; cat_a uuid; cat_b uuid; prod_b uuid; prod_new uuid;
  n bigint; err text; c numeric; legacy numeric;
  fails text[] := '{}'; total int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_owner_a, 'owner-a@pc.test', jsonb_build_object('name','Dono A','phone','11999990001','document','12345678062')),
    (u_staff_a, 'staff-a@pc.test', jsonb_build_object('name','Equipe A','phone','11999990002','document','98765432029')),
    (u_owner_b, 'owner-b@pc.test', jsonb_build_object('name','Dono B','phone','11999990003','document','24681357090')),
    (u_stranger,'stranger@pc.test',jsonb_build_object('name','Estranho','phone','11999990005','document','86420975310'));
  update public.profiles set trial_ends_at = now() + interval '30 days' where user_id in (u_owner_a, u_owner_b);

  insert into public.restaurants (name, slug) values ('Loja A', 'pc-a') returning id into r_a;
  insert into public.restaurants (name, slug) values ('Loja B', 'pc-b') returning id into r_b;
  insert into public.restaurant_members (restaurant_id, user_id, role) values
    (r_a, u_owner_a, 'OWNER'), (r_a, u_staff_a, 'STAFF'), (r_b, u_owner_b, 'OWNER');
  update public.restaurants set onboarding_completed = true, status = 'active' where id in (r_a, r_b);
  insert into public.categories (restaurant_id, name, display_order) values (r_a, 'cat-a', 1) returning id into cat_a;
  insert into public.categories (restaurant_id, name, display_order) values (r_b, 'cat-b', 1) returning id into cat_b;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_b, 'prod-b', 10, cat_b, 1) returning id into prod_b;
  insert into public.product_costs (product_id, restaurant_id, cost) values (prod_b, r_b, 4.00);

  -- ---------- 0) catálogo ----------
  total := total + 1;
  if not exists (select 1 from pg_class where oid = 'public.product_costs'::regclass and relrowsecurity) then
    fails := fails || 'product_costs sem RLS'::text;
  end if;
  total := total + 1;
  if has_table_privilege('anon','public.product_costs','SELECT') or has_table_privilege('anon','public.product_costs','INSERT')
     or has_table_privilege('anon','public.product_costs','UPDATE') or has_table_privilege('anon','public.product_costs','DELETE') then
    fails := fails || 'anon tem privilegio em product_costs'::text;
  end if;
  total := total + 1;
  if not has_table_privilege('authenticated','public.product_costs','SELECT')
     or has_table_privilege('authenticated','public.product_costs','INSERT')
     or has_table_privilege('authenticated','public.product_costs','UPDATE')
     or has_table_privilege('authenticated','public.product_costs','DELETE') then
    fails := fails || 'authenticated deveria so ler product_costs'::text;
  end if;

  -- ---------- 1) OWNER A cria produto com custo ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    select id into prod_new from public.create_product(r_a, cat_a, 'X-Tudo', 'desc', 39.99, 12.5, true);
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err <> 'ok' then fails := fails || format('create_product com custo falhou: %s', err); end if;
  select cost into c from public.product_costs where product_id = prod_new;
  total := total + 1;
  if c is distinct from 12.50 then fails := fails || format('custo nao gravado em product_costs (veio %s)', coalesce(c::text, 'null')); end if;
  select cost into legacy from public.products where id = prod_new;
  total := total + 1;
  if legacy is not null then fails := fails || 'products.cost ainda esta sendo escrito'::text; end if;

  -- sem custo: nenhuma linha
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform id from public.create_product(r_a, cat_a, 'Sem custo', null, 5, null, true);
  reset role;
  total := total + 1;
  if (select count(*) from public.product_costs where restaurant_id = r_a) <> 1 then fails := fails || 'produto sem custo criou linha em product_costs'::text; end if;

  -- ---------- 2) update_product: altera e remove o custo ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform id from public.update_product(prod_new, cat_a, 'X-Tudo', 'desc', 39.99, 15.75, true);
  reset role;
  select cost into c from public.product_costs where product_id = prod_new;
  total := total + 1;
  if c is distinct from 15.75 then fails := fails || format('update_product nao alterou o custo (veio %s)', coalesce(c::text, 'null')); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform id from public.update_product(prod_new, cat_a, 'X-Tudo', 'desc', 39.99, null, true);
  reset role;
  total := total + 1;
  if exists (select 1 from public.product_costs where product_id = prod_new) then fails := fails || 'custo nulo deveria apagar a linha'::text; end if;

  -- custo negativo
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform id from public.update_product(prod_new, cat_a, 'X-Tudo', 'desc', 39.99, -1, true);
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%invalid_cost%' then fails := fails || format('custo negativo deveria ser recusado (%s)', err); end if;

  -- volta a ter custo para os testes de leitura
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform id from public.update_product(prod_new, cat_a, 'X-Tudo', 'desc', 39.99, 12.5, true);
  reset role;

  -- ---------- 3) quem lê ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.product_costs;
  reset role;
  total := total + 1;
  if n <> 1 then fails := fails || format('OWNER A deveria ver so o proprio custo (n=%s)', n); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_staff_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.product_costs;
  reset role;
  total := total + 1;
  if n <> 1 then fails := fails || format('membro (STAFF) mantem a leitura que ja tinha (n=%s)', n); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.product_costs where restaurant_id = r_a;
  reset role;
  total := total + 1;
  if n <> 0 then fails := fails || 'OWNER B leu custo da loja A'::text; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.product_costs;
  reset role;
  total := total + 1;
  if n <> 0 then fails := fails || format('usuario logado sem loja leu custos (n=%s)', n); end if;

  set local role anon;
  begin
    select count(*) into n from public.product_costs;
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%permission denied%' then fails := fails || format('visitante conseguiu ler product_costs (%s)', err); end if;

  -- ---------- 4) ninguém escreve direto ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.product_costs (product_id, restaurant_id, cost) values (prod_new, r_a, 1);
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%permission denied%' then fails := fails || format('OWNER escreveu direto em product_costs (%s)', err); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.product_costs set cost = 0.01 where product_id = prod_new;
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%permission denied%' then fails := fails || format('OWNER atualizou direto product_costs (%s)', err); end if;

  -- STAFF não cria nem altera custo pelas funções
  perform set_config('request.jwt.claims', json_build_object('sub', u_staff_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform id from public.update_product(prod_new, cat_a, 'X-Tudo', 'desc', 39.99, 0.5, true);
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%not_authorized%' then fails := fails || format('STAFF alterou produto/custo pela funcao (%s)', err); end if;

  -- OWNER A não mexe no produto da loja B
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform id from public.update_product(prod_b, cat_a, 'invasao', null, 10, 0.1, true);
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%not_authorized%' then fails := fails || format('OWNER A alterou produto da loja B (%s)', err); end if;
  total := total + 1;
  if (select cost from public.product_costs where product_id = prod_b) is distinct from 4.00 then fails := fails || 'custo da loja B foi alterado'::text; end if;

  -- ---------- 5) apagar o produto apaga o custo ----------
  delete from public.products where id = prod_new;
  total := total + 1;
  if exists (select 1 from public.product_costs where product_id = prod_new) then fails := fails || 'custo sobrou depois de apagar o produto'::text; end if;

  -- ---------- relatório ----------
  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes', total;
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %', array_length(fails, 1), total, array_to_string(fails, ' ## ');
  end if;
end $$;
