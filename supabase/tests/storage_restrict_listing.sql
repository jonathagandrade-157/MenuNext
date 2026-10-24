-- MenuNext — teste de regressão do P1-02d: leitura de storage.objects só para membros.
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO. Tudo fica dentro de UMA transação que SEMPRE termina com
-- `raise exception` (nada persiste), mas NÃO use contra o banco de produção.
-- Resultado: a mensagem final do erro (RESULTADO: OK | N verificacoes  /  RESULTADO: FALHOU ...).
-- Pré-requisito: migrations até 20261009050000_storage_restrict_listing.sql aplicadas.

do $$
declare
  u_owner_a uuid := gen_random_uuid();
  u_staff_a uuid := gen_random_uuid();
  u_owner_b uuid := gen_random_uuid();
  u_none uuid := gen_random_uuid();
  r_a uuid; r_b uuid; a text; b text;
  c record; n bigint; err text;
  fails text[] := '{}'; total int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_owner_a, 'owner-a@listing.test', jsonb_build_object('name','Owner A','phone','11999990001','document','52998224725')),
    (u_staff_a, 'staff-a@listing.test', jsonb_build_object('name','Staff A','phone','11999990002','document','11144477735')),
    (u_owner_b, 'owner-b@listing.test', jsonb_build_object('name','Owner B','phone','11999990003','document','39053344705')),
    (u_none,    'none@listing.test',    jsonb_build_object('name','Sem loja','phone','11999990004','document','12345678909'));
  insert into public.restaurants (name, slug) values ('Loja A', 'list-a') returning id into r_a;
  insert into public.restaurants (name, slug) values ('Loja B', 'list-b') returning id into r_b;
  insert into public.restaurant_members (restaurant_id, user_id, role) values
    (r_a, u_owner_a, 'OWNER'), (r_a, u_staff_a, 'STAFF'), (r_b, u_owner_b, 'OWNER');
  a := r_a::text; b := r_b::text;
  insert into storage.objects (bucket_id, name) values
    ('restaurant-assets', a || '/branding/logo.png'), ('restaurant-assets', a || '/branding/cover.png'),
    ('restaurant-assets', b || '/branding/logo.png');

  for c in select * from (values
    ('anon',    'anon nao lista nenhum objeto',                    0::bigint),
    ('none',    'usuario logado sem loja nao lista nenhum objeto', 0),
    ('owner_a', 'OWNER A lista so os 2 objetos da loja A',         2),
    ('staff_a', 'STAFF A lista so os 2 objetos da loja A',         2),
    ('owner_b', 'OWNER B lista so o objeto da loja B',             1)
  ) as t(persona, label, expected) loop
    total := total + 1;
    err := null; n := null;
    reset role;
    begin
      perform set_config('request.jwt.claims', case c.persona
        when 'owner_a' then jsonb_build_object('sub', u_owner_a, 'role', 'authenticated')::text
        when 'staff_a' then jsonb_build_object('sub', u_staff_a, 'role', 'authenticated')::text
        when 'owner_b' then jsonb_build_object('sub', u_owner_b, 'role', 'authenticated')::text
        when 'none'    then jsonb_build_object('sub', u_none, 'role', 'authenticated')::text
        else jsonb_build_object('role', 'anon')::text end, true);
      execute format('set local role %I', case c.persona when 'anon' then 'anon' else 'authenticated' end);
      select count(*) into n from storage.objects where bucket_id = 'restaurant-assets';
    exception when others then
      err := sqlerrm;
    end;
    reset role;
    if err is not null then
      -- anon sem privilegio de leitura tambem e "nao lista": erro de permissao e aceito para o anon
      if not (c.persona = 'anon' and err ~* 'permission denied') then fails := fails || format('%s (ERRO: %s)', c.label, err); end if;
    elsif n <> c.expected then
      fails := fails || format('%s (esperado %s, obtido %s)', c.label, c.expected, n);
    end if;
  end loop;
  reset role;

  total := total + 1;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'restaurant_assets_select_public') then
    fails := fails || 'a policy publica de leitura ainda existe'::text;
  end if;

  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes', total;
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %', array_length(fails, 1), total, array_to_string(fails, ' ## ');
  end if;
end $$;
