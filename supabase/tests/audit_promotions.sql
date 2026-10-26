-- MenuNext — teste de regressão: promoções no registro de auditoria.
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO (local ou branch). Cria usuários e lojas de teste; tudo fica
-- numa transação que SEMPRE termina com `raise exception` (nada persiste).
-- Resultado: a mensagem final do erro é o relatório ("RESULTADO: OK | N verificacoes" ou "FALHOU").
--
-- Regras testadas: criar/alterar/excluir promoção gera registro com autor, papel e rótulo "Promoção";
-- só NOMES de colunas (nunca valores); STAFF não escreve (nada é registrado); ação sem JWT não entra;
-- as demais tabelas continuam sendo registradas; a função continua fechada (sem EXECUTE para app).

do $$
declare
  u_owner uuid := gen_random_uuid();
  u_staff uuid := gen_random_uuid();
  r_a uuid; promo uuid; prod uuid; cat uuid;
  n bigint; n0 bigint; s text; role_seen text; err text;
  fails text[] := '{}'; total int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_owner, 'owner@ap.test', jsonb_build_object('name','Dona','phone','11999990001','document','12345678062')),
    (u_staff, 'staff@ap.test', jsonb_build_object('name','Equipe','phone','11999990002','document','98765432029'));
  insert into public.restaurants (name, slug) values ('Loja AP', 'ap-loja') returning id into r_a;
  insert into public.restaurant_members (restaurant_id, user_id, role) values (r_a, u_owner, 'OWNER'), (r_a, u_staff, 'STAFF');
  insert into public.categories (restaurant_id, name, display_order) values (r_a, 'cat', 1) returning id into cat;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_a, 'prod', 10, cat, 1) returning id into prod;

  -- catálogo
  total := total + 1;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.promotions'::regclass and tgname = 'audit_promotions' and not tgisinternal) then
    fails := fails || 'gatilho audit_promotions ausente'::text;
  end if;
  total := total + 1;
  if has_function_privilege('authenticated', 'public.audit_row_change()', 'EXECUTE') or has_function_privilege('anon', 'public.audit_row_change()', 'EXECUTE') then
    fails := fails || 'audit_row_change ficou executavel pelo app'::text;
  end if;
  total := total + 1;
  if position('Promoção' in pg_get_functiondef('public.audit_row_change()'::regprocedure)) = 0 then
    fails := fails || 'rotulo Promocao ausente da funcao'::text;
  end if;

  -- sem JWT (setup, backend): não registra
  insert into public.promotions (restaurant_id, name, discount_type, discount_value) values (r_a, 'Setup sem JWT', 'fixed', 1);
  total := total + 1;
  select count(*) into n from public.audit_log where entity = 'promotions';
  if n <> 0 then fails := fails || format('escrita sem JWT foi registrada (n=%s)', n); end if;
  delete from public.promotions where restaurant_id = r_a;

  -- OWNER cria
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.promotions (restaurant_id, name, discount_type, discount_value, min_order_value) values (r_a, 'Happy hour', 'percent', 15, 40) returning id into promo;
  reset role;
  total := total + 1;
  select count(*), max(summary), max(actor_role) into n, s, role_seen from public.audit_log where entity = 'promotions' and action = 'insert' and entity_id = promo;
  if n <> 1 or s is distinct from 'Promoção "Happy hour" criado' then fails := fails || format('criacao: n=%s resumo=%s', n, coalesce(s, 'null')); end if;
  total := total + 1;
  if role_seen is distinct from 'OWNER' then fails := fails || format('papel do autor (veio %s)', coalesce(role_seen, 'null')); end if;
  total := total + 1;
  if not exists (select 1 from public.audit_log where entity_id = promo and actor_user_id = u_owner and restaurant_id = r_a) then
    fails := fails || 'autor/loja nao gravados'::text;
  end if;

  -- OWNER altera: só nomes de colunas, nunca valores
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.promotions set discount_value = 77, is_active = false where id = promo;
  reset role;
  total := total + 1;
  select max(summary) into s from public.audit_log where entity = 'promotions' and action = 'update' and entity_id = promo;
  if s is distinct from 'Promoção "Happy hour" alterado (discount_value, is_active)' then fails := fails || format('alteracao: resumo=%s', coalesce(s, 'null')); end if;
  total := total + 1;
  if s like '%77%' then fails := fails || 'resumo vazou valor'::text; end if;

  -- update vazio não conta
  select count(*) into n0 from public.audit_log;
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.promotions set name = name where id = promo;
  reset role;
  total := total + 1;
  select count(*) into n from public.audit_log;
  if n <> n0 then fails := fails || 'update sem mudanca gerou registro'::text; end if;

  -- STAFF não consegue escrever, então nada novo é registrado
  select count(*) into n0 from public.audit_log;
  perform set_config('request.jwt.claims', json_build_object('sub', u_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.promotions (restaurant_id, name, discount_type, discount_value) values (r_a, 'Hack', 'fixed', 1);
    err := 'ok';
  exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  select count(*) into n from public.audit_log;
  if err not ilike '%row-level security%' or n <> n0 then fails := fails || format('STAFF escreveu ou foi registrado (%s)', err); end if;

  -- OWNER exclui
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.promotions where id = promo;
  reset role;
  total := total + 1;
  select max(summary) into s from public.audit_log where entity = 'promotions' and action = 'delete' and entity_id = promo;
  if s is distinct from 'Promoção "Happy hour" removido' then fails := fails || format('exclusao: resumo=%s', coalesce(s, 'null')); end if;

  -- leitura do OWNER mostra a promoção
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.restaurant_audit_recent(50) where summary like 'Promoção%';
  reset role;
  total := total + 1;
  if n <> 3 then fails := fails || format('OWNER deveria ler 3 registros de promocao (n=%s)', n); end if;

  -- regressão: as outras tabelas seguem registrando
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.products set price = 12 where id = prod;
  reset role;
  total := total + 1;
  if not exists (select 1 from public.audit_log where entity = 'products' and summary = 'Produto "prod" alterado (price)') then
    fails := fails || 'regressao: produto deixou de ser registrado'::text;
  end if;

  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes', total;
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %', array_length(fails, 1), total, array_to_string(fails, ' ## ');
  end if;
end $$;
