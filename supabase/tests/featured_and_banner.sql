-- MenuNext — teste de regressão: produtos em destaque e banner da loja.
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO (local ou branch). Cria usuários e lojas de teste; tudo fica
-- numa transação que SEMPRE termina com `raise exception` (nada persiste).
-- Resultado: a mensagem final do erro é o relatório ("RESULTADO: OK | N verificacoes" ou "FALHOU").
--
-- Regras testadas: OWNER marca destaque e grava o banner da própria loja; STAFF não faz nenhum dos dois
-- (mas segue ligando/desligando a disponibilidade); outra loja não toca nos dados; visitante só lê o
-- banner de loja publicada e nunca grava; o texto do banner tem limite.

do $$
declare
  u_owner_a uuid := gen_random_uuid();
  u_staff_a uuid := gen_random_uuid();
  u_owner_b uuid := gen_random_uuid();
  r_a uuid; r_b uuid; cat_a uuid; cat_b uuid; prod_a uuid; prod_b uuid;
  n bigint; err text; old_updated timestamptz;
  fails text[] := '{}'; total int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_owner_a, 'owner-a@fb.test', jsonb_build_object('name','Owner A','phone','11999990001','document','12345678062')),
    (u_staff_a, 'staff-a@fb.test', jsonb_build_object('name','Staff A','phone','11999990002','document','98765432029')),
    (u_owner_b, 'owner-b@fb.test', jsonb_build_object('name','Owner B','phone','11999990003','document','24681357090'));
  update public.profiles set trial_ends_at = now() + interval '30 days' where user_id in (u_owner_a, u_owner_b);

  insert into public.restaurants (name, slug) values ('Loja A', 'fb-a') returning id into r_a;
  insert into public.restaurants (name, slug) values ('Loja B', 'fb-b') returning id into r_b;
  insert into public.restaurant_members (restaurant_id, user_id, role) values
    (r_a, u_owner_a, 'OWNER'), (r_a, u_staff_a, 'STAFF'), (r_b, u_owner_b, 'OWNER');
  -- só a loja A é publicada; a B segue em rascunho
  update public.restaurants set onboarding_completed = true, status = 'active' where id = r_a;
  insert into public.categories (restaurant_id, name, display_order) values (r_a, 'cat-a', 1) returning id into cat_a;
  insert into public.categories (restaurant_id, name, display_order) values (r_b, 'cat-b', 1) returning id into cat_b;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_a, 'prod-a', 10, cat_a, 1) returning id into prod_a;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_b, 'prod-b', 10, cat_b, 1) returning id into prod_b;

  -- ---------- 0) catálogo ----------
  total := total + 1;
  if not exists (select 1 from pg_class where oid = 'public.restaurant_banners'::regclass and relrowsecurity) then
    fails := fails || 'restaurant_banners sem RLS'::text;
  end if;
  total := total + 1;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='products'
                 and column_name='is_featured' and data_type='boolean' and column_default='false' and is_nullable='NO') then
    fails := fails || 'products.is_featured ausente ou fora do padrão'::text;
  end if;
  total := total + 1;
  if has_table_privilege('anon','public.restaurant_banners','INSERT') or has_table_privilege('anon','public.restaurant_banners','UPDATE')
     or has_table_privilege('anon','public.restaurant_banners','DELETE') then
    fails := fails || 'anon tem escrita em restaurant_banners'::text;
  end if;
  total := total + 1;
  if has_table_privilege('authenticated','public.restaurant_banners','DELETE') then
    fails := fails || 'authenticated tem DELETE em restaurant_banners'::text;
  end if;

  -- ---------- 1) OWNER A: grava o banner e marca destaque ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.restaurant_banners (restaurant_id, is_enabled, message) values (r_a, true, 'Terça do Burger: 20% off');
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err <> 'ok' then fails := fails || format('OWNER nao conseguiu criar o banner: %s', err); end if;

  -- now() não muda dentro da transação: para provar o trigger, o updated_at começa antigo
  alter table public.restaurant_banners disable trigger set_updated_at;
  update public.restaurant_banners set updated_at = '2020-01-01 00:00:00+00' where restaurant_id = r_a;
  alter table public.restaurant_banners enable trigger set_updated_at;
  old_updated := '2020-01-01 00:00:00+00';
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.restaurant_banners set message = 'Novo texto' where restaurant_id = r_a;
    get diagnostics n = row_count; err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err <> 'ok' or n <> 1 then fails := fails || format('OWNER nao atualizou o banner (n=%s, %s)', n, err); end if;
  total := total + 1;
  if not exists (select 1 from public.restaurant_banners where restaurant_id = r_a and updated_at > old_updated) then
    fails := fails || 'trigger set_updated_at nao moveu updated_at do banner'::text;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.products set is_featured = true where id = prod_a;
    get diagnostics n = row_count; err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err <> 'ok' or n <> 1 then fails := fails || format('OWNER nao marcou destaque (n=%s, %s)', n, err); end if;
  total := total + 1;
  if not (select is_featured from public.products where id = prod_a) then fails := fails || 'destaque do OWNER nao ficou gravado'::text; end if;

  -- limite de 140 caracteres
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.restaurant_banners set message = repeat('x', 141) where restaurant_id = r_a;
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%check constraint%' then fails := fails || format('banner de 141 caracteres deveria ser barrado pelo CHECK (veio: %s)', err); end if;

  -- OWNER A não cria banner nem marca destaque na loja B
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.restaurant_banners (restaurant_id, is_enabled, message) values (r_b, true, 'invasao');
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%row-level security%' then fails := fails || format('OWNER A criou banner na loja B (%s)', err); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.products set is_featured = true where id = prod_b;
  get diagnostics n = row_count;
  reset role;
  total := total + 1;
  if n <> 0 then fails := fails || 'OWNER A alterou destaque de produto da loja B'::text; end if;

  -- ---------- 2) STAFF A: nada de banner nem destaque; disponibilidade continua ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_staff_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.restaurant_banners set message = 'staff mexeu' where restaurant_id = r_a;
    get diagnostics n = row_count; err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if n <> 0 or err <> 'ok' then fails := fails || format('STAFF alterou o banner (n=%s, %s)', n, err); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_staff_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.restaurant_banners (restaurant_id, is_enabled, message) values (r_a, true, 'staff');
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%row-level security%' and err not ilike '%duplicate key%' then
    fails := fails || format('STAFF inseriu banner (%s)', err);
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_staff_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.products set is_featured = false where id = prod_a;
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%owner_required%' then fails := fails || format('STAFF desmarcou destaque (%s)', err); end if;
  total := total + 1;
  if not (select is_featured from public.products where id = prod_a) then fails := fails || 'destaque foi alterado pelo STAFF'::text; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_staff_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.products set is_available = false where id = prod_a;
    get diagnostics n = row_count; err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err <> 'ok' or n <> 1 then fails := fails || format('STAFF perdeu o direito de ligar/desligar disponibilidade (%s)', err); end if;

  -- ---------- 3) OWNER B ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.restaurant_banners set message = 'invasao B' where restaurant_id = r_a;
  reset role;
  total := total + 1;
  if exists (select 1 from public.restaurant_banners where restaurant_id = r_a and message = 'invasao B') then
    fails := fails || 'OWNER B alterou o banner da loja A'::text;
  end if;

  -- OWNER B cria o banner da PRÓPRIA loja (em rascunho) e consegue lê-lo
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.restaurant_banners (restaurant_id, is_enabled, message) values (r_b, true, 'banner da B');
  select count(*) into n from public.restaurant_banners where restaurant_id = r_b;
  reset role;
  total := total + 1;
  if n <> 1 then fails := fails || 'OWNER nao le o proprio banner com a loja em rascunho'::text; end if;

  -- ---------- 4) visitante ----------
  set local role anon;
  select count(*) into n from public.restaurant_banners where restaurant_id = r_a;
  reset role;
  total := total + 1;
  if n <> 1 then fails := fails || format('visitante nao le o banner da loja publicada (n=%s)', n); end if;

  set local role anon;
  select count(*) into n from public.restaurant_banners where restaurant_id = r_b;
  reset role;
  total := total + 1;
  if n <> 0 then fails := fails || 'visitante leu banner de loja em rascunho'::text; end if;

  set local role anon;
  begin
    update public.restaurant_banners set message = 'anon' where restaurant_id = r_a;
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%permission denied%' then fails := fails || format('visitante conseguiu escrever no banner (%s)', err); end if;

  set local role anon;
  select count(*) into n from public.products where restaurant_id = r_a and is_featured;
  reset role;
  total := total + 1;
  if n <> 1 then fails := fails || format('visitante nao enxerga is_featured dos produtos publicados (n=%s)', n); end if;

  -- ---------- relatório ----------
  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes', total;
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %', array_length(fails, 1), total, array_to_string(fails, ' ## ');
  end if;
end $$;
