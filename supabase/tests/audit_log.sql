-- MenuNext — teste de regressão: registro de auditoria.
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO (local ou branch). Cria usuários e lojas de teste; tudo fica
-- numa transação que SEMPRE termina com `raise exception` (nada persiste).
-- Resultado: a mensagem final do erro é o relatório ("RESULTADO: OK | N verificacoes" ou "FALHOU").
--
-- Regras testadas: só ações de pessoas (JWT) são registradas, com autor e papel; backend não entra;
-- alterações listam só NOMES de colunas (nunca valores); reordenar não conta; o OWNER lê só o registro
-- da própria loja (STAFF/estranho/visitante não); só o master lê tudo; a tabela é fechada; e uma falha
-- ao registrar nunca impede a operação do lojista.

do $$
declare
  u_owner_a uuid := gen_random_uuid();
  u_staff_a uuid := gen_random_uuid();
  u_owner_b uuid := gen_random_uuid();
  u_master  uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  r_a uuid; r_b uuid; cat_a uuid; cat_b uuid; prod_a uuid; prod_a2 uuid; prod_b uuid;
  n bigint; n0 bigint; err text; s text; role_seen text; tot bigint;
  fails text[] := '{}'; total int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_owner_a, 'owner-a@au.test', jsonb_build_object('name','Dona A','phone','11999990001','document','12345678062')),
    (u_staff_a, 'staff-a@au.test', jsonb_build_object('name','Equipe A','phone','11999990002','document','98765432029')),
    (u_owner_b, 'owner-b@au.test', jsonb_build_object('name','Dono B','phone','11999990003','document','24681357090')),
    (u_master,  'master@au.test',  jsonb_build_object('name','Master','phone','11999990004','document','13579246828')),
    (u_stranger,'stranger@au.test',jsonb_build_object('name','Estranho','phone','11999990005','document','86420975310'));
  update public.profiles set is_master = true where user_id = u_master;
  update public.profiles set trial_ends_at = now() + interval '30 days' where user_id in (u_owner_a, u_owner_b);

  insert into public.restaurants (name, slug) values ('Loja A', 'au-a') returning id into r_a;
  insert into public.restaurants (name, slug) values ('Loja B', 'au-b') returning id into r_b;
  insert into public.restaurant_members (restaurant_id, user_id, role) values
    (r_a, u_owner_a, 'OWNER'), (r_a, u_staff_a, 'STAFF'), (r_b, u_owner_b, 'OWNER');
  insert into public.categories (restaurant_id, name, display_order) values (r_a, 'cat-a', 1) returning id into cat_a;
  insert into public.categories (restaurant_id, name, display_order) values (r_b, 'cat-b', 1) returning id into cat_b;
  insert into public.products (restaurant_id, name, price, cost, category_id, display_order) values (r_a, 'prod-a', 10, 2.5, cat_a, 1) returning id into prod_a;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_a, 'prod-a2', 12, cat_a, 2) returning id into prod_a2;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_b, 'prod-b', 10, cat_b, 1) returning id into prod_b;

  -- ---------- 0) catálogo e privilégios ----------
  total := total + 1;
  if not exists (select 1 from pg_class where oid = 'public.audit_log'::regclass and relrowsecurity) then
    fails := fails || 'audit_log sem RLS'::text;
  end if;
  total := total + 1;
  if has_table_privilege('anon','public.audit_log','SELECT') or has_table_privilege('authenticated','public.audit_log','SELECT')
     or has_table_privilege('authenticated','public.audit_log','INSERT') or has_table_privilege('authenticated','public.audit_log','UPDATE')
     or has_table_privilege('authenticated','public.audit_log','DELETE') then
    fails := fails || 'audit_log tem privilegio direto para anon/authenticated'::text;
  end if;
  total := total + 1;
  if has_function_privilege('anon', 'public.restaurant_audit_recent(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.master_audit_list(integer,integer,uuid)', 'EXECUTE') then
    fails := fails || 'anon executa as funcoes de leitura da auditoria'::text;
  end if;
  total := total + 1;
  if has_function_privilege('authenticated', 'public.audit_row_change()', 'EXECUTE') then
    fails := fails || 'authenticated executa a funcao de gatilho diretamente'::text;
  end if;

  -- ---------- 1) escritas sem JWT (setup acima, backend) não entram ----------
  total := total + 1;
  select count(*) into n from public.audit_log;
  if n <> 0 then fails := fails || format('escritas sem JWT foram registradas (n=%s)', n); end if;

  -- ---------- 2) OWNER A altera produto: autor, papel e nomes de colunas (sem valores) ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.products set price = 11, cost = 3.33 where id = prod_a;
  reset role;
  total := total + 1;
  select count(*), max(summary), max(actor_role) into n, s, role_seen from public.audit_log where restaurant_id = r_a and entity = 'products' and action = 'update';
  if n <> 1 then fails := fails || format('alteracao de produto deveria gerar 1 registro (n=%s)', n); end if;
  total := total + 1;
  if s is null or s not like 'Produto "prod-a" alterado (%cost%price%)' then fails := fails || format('resumo inesperado: %s', coalesce(s, 'null')); end if;
  total := total + 1;
  if s like '%3.33%' or s like '%11%' then fails := fails || 'resumo vazou valor de coluna'::text; end if;
  total := total + 1;
  if role_seen is distinct from 'OWNER' then fails := fails || format('papel do autor deveria ser OWNER (veio %s)', coalesce(role_seen, 'null')); end if;
  total := total + 1;
  if not exists (select 1 from public.audit_log where actor_user_id = u_owner_a and entity_id = prod_a) then
    fails := fails || 'autor/entidade nao gravados'::text;
  end if;

  -- reordenar (display_order) e update sem mudança não contam
  select count(*) into n0 from public.audit_log;
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.products set display_order = 7 where id = prod_a2;
  update public.products set name = name where id = prod_a2;
  reset role;
  total := total + 1;
  select count(*) into n from public.audit_log;
  if n <> n0 then fails := fails || format('reordenar/update vazio gerou registro (%s -> %s)', n0, n); end if;

  -- criar e remover
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.categories (restaurant_id, name, display_order) values (r_a, 'cat-nova', 9);
  delete from public.products where id = prod_a2;
  reset role;
  total := total + 1;
  if not exists (select 1 from public.audit_log where entity = 'categories' and action = 'insert' and summary = 'Categoria "cat-nova" criado') then
    fails := fails || 'criacao de categoria nao registrada'::text;
  end if;
  total := total + 1;
  if not exists (select 1 from public.audit_log where entity = 'products' and action = 'delete' and summary = 'Produto "prod-a2" removido') then
    fails := fails || 'remocao de produto nao registrada'::text;
  end if;

  -- dados da loja e banner
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.restaurants set bio = 'nova bio' where id = r_a;
  insert into public.restaurant_banners (restaurant_id, is_enabled, message) values (r_a, true, 'oferta');
  reset role;
  total := total + 1;
  if not exists (select 1 from public.audit_log where entity = 'restaurants' and summary = 'Dados da loja alterado (bio)') then
    fails := fails || 'alteracao da loja nao registrada (ou com colunas a mais)'::text;
  end if;
  total := total + 1;
  if not exists (select 1 from public.audit_log where entity = 'restaurant_banners' and action = 'insert') then
    fails := fails || 'banner nao registrado'::text;
  end if;

  -- ---------- 3) STAFF liga/desliga disponibilidade: registrado com o papel certo ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_staff_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.products set is_available = false where id = prod_a;
  reset role;
  total := total + 1;
  if not exists (select 1 from public.audit_log where actor_user_id = u_staff_a and actor_role = 'STAFF' and summary like '%is_available%') then
    fails := fails || 'acao do STAFF nao registrada com papel STAFF'::text;
  end if;

  -- ---------- 4) OWNER B: registro próprio, isolado ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.products set price = 20 where id = prod_b;
  reset role;
  total := total + 1;
  if not exists (select 1 from public.audit_log where restaurant_id = r_b and entity_id = prod_b) then
    fails := fails || 'acao do OWNER B nao registrada na loja B'::text;
  end if;

  -- ---------- 5) leitura pelo OWNER (só a própria loja) ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.restaurant_audit_recent(100);
  select count(*) into tot from public.restaurant_audit_recent(100) where summary like '%prod-b%';
  reset role;
  total := total + 1;
  if n < 6 then fails := fails || format('OWNER A deveria ver os proprios registros (n=%s)', n); end if;
  total := total + 1;
  if tot <> 0 then fails := fails || 'OWNER A enxerga registro da loja B'::text; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.restaurant_audit_recent(100);
  select count(*) into tot from public.restaurant_audit_recent(100) where summary not like '%prod-b%';
  reset role;
  total := total + 1;
  if n <> 1 or tot <> 0 then fails := fails || format('OWNER B deveria ver so 1 registro dele (n=%s, outros=%s)', n, tot); end if;

  -- STAFF e estranho recebem vazio
  perform set_config('request.jwt.claims', json_build_object('sub', u_staff_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.restaurant_audit_recent(100);
  reset role;
  total := total + 1;
  if n <> 0 then fails := fails || format('STAFF leu o registro (n=%s)', n); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.restaurant_audit_recent(100);
  reset role;
  total := total + 1;
  if n <> 0 then fails := fails || format('usuario sem loja leu o registro (n=%s)', n); end if;

  -- leitura direta da tabela e visitante
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    select count(*) into n from public.audit_log;
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%permission denied%' then fails := fails || format('OWNER leu a tabela direto (%s)', err); end if;

  set local role anon;
  begin
    perform * from public.restaurant_audit_recent(10);
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%permission denied%' then fails := fails || format('visitante executou a leitura (%s)', err); end if;

  -- ---------- 6) master ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform * from public.master_audit_list(10, 0, null);
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%not_authorized%' then fails := fails || format('nao-master executou master_audit_list (%s)', err); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_master, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*), max(m.total) into n, tot from public.master_audit_list(3, 0, null) m;
  reset role;
  total := total + 1;
  if n <> 3 or tot <> 7 then fails := fails || format('master: paginacao/total inesperados (n=%s, total=%s)', n, tot); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_master, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*), count(*) filter (where restaurant_name = 'Loja B') into n, tot from public.master_audit_list(50, 0, r_b);
  reset role;
  total := total + 1;
  if n <> 1 or tot <> 1 then fails := fails || format('master: filtro por loja falhou (n=%s, B=%s)', n, tot); end if;

  -- a ordem é do mais novo para o mais antigo
  perform set_config('request.jwt.claims', json_build_object('sub', u_master, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from (
    select created_at, lag(created_at) over (order by ordinality) as prev
      from public.master_audit_list(50, 0, null) with ordinality
  ) t where prev is not null and created_at > prev;
  reset role;
  total := total + 1;
  if n <> 0 then fails := fails || 'master: lista fora de ordem'::text; end if;

  -- ---------- 7) backend (service_role) não é registrado ----------
  select count(*) into n0 from public.audit_log;
  perform set_config('request.jwt.claims', '', true);
  set local role service_role;
  update public.products set price = 99 where id = prod_a;
  reset role;
  total := total + 1;
  select count(*) into n from public.audit_log;
  if n <> n0 then fails := fails || format('acao do backend foi registrada (%s -> %s)', n0, n); end if;

  -- ---------- 8) falha ao registrar nunca impede a operação ----------
  alter table public.audit_log add constraint au_test_always_fail check (false) not valid;
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.products set price = 15 where id = prod_a;
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err <> 'ok' then fails := fails || format('falha na auditoria bloqueou a operacao (%s)', err); end if;
  total := total + 1;
  if (select price from public.products where id = prod_a) <> 15 then fails := fails || 'a escrita nao foi aplicada'::text; end if;
  alter table public.audit_log drop constraint au_test_always_fail;

  -- ---------- relatório ----------
  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes', total;
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %', array_length(fails, 1), total, array_to_string(fails, ' ## ');
  end if;
end $$;
