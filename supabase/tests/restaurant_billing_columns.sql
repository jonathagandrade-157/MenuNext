-- MenuNext — teste de regressão do P0-01: colunas de assinatura/cobrança de
-- public.restaurants não podem ser alteradas por nenhum usuário da API.
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO (local, branch do Supabase ou banco de
-- teste). O script cria usuários em auth.users e linhas de teste, e a fase 3
-- executa um GRANT para simular uma regressão. Tudo fica dentro de UMA
-- transação que SEMPRE termina com `raise exception`, então nada persiste,
-- mas NÃO use contra o banco de produção.
--
-- Como ler o resultado: a mensagem final do erro é o relatório.
--   RESULTADO: OK | N verificacoes            -> tudo protegido
--   RESULTADO: FALHOU (k) | N verificacoes | ... -> lista cada violação
-- O teste FALHA se qualquer alteração proibida for aceita (ver fase 1, 2, 3).
--
-- Personas (role e JWT iguais aos do PostgREST):
--   owner_a   OWNER da loja A         staff_a   STAFF da loja A
--   owner_b   OWNER da loja B (outra loja)
--   master    master da plataforma, NÃO membro da loja A
--   anon      visitante sem login
--   sys       dono do banco (setup, verificação e fluxos internos)
-- Papel MANAGER não existe no schema (check de restaurant_members.role); a
-- proteção é por role de banco, não por papel, e uma checagem no fim do
-- script avisa se MANAGER passar a existir.
--
-- Fases:
--   0 catálogo   privilégios, classificação de colunas, trigger
--   1 ataques    colunas de cobrança, trial, estrutura, cross-tenant; e
--                atualização operacional legítima (controle positivo)
--   2 fluxos     trial, assinatura, webhook (atraso, pagamento, cancelamento)
--   3 2ª camada  reabre o GRANT de propósito: o trigger ainda deve barrar

do $$
declare
  u_owner_a uuid := gen_random_uuid();
  u_staff_a uuid := gen_random_uuid();
  u_owner_b uuid := gen_random_uuid();
  u_master  uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  r_a uuid; r_b uuid; v_plan uuid;

  protected_cols text[] := array['plan_id', 'subscription_status', 'asaas_customer_id',
                                 'asaas_subscription_id', 'subscription_current_period_end'];
  protected_vals text[];
  operational_cols text[] := array[
    'name','slug','status','onboarding_completed','onboarding_step',
    'address_zip','address_street','address_number','address_complement',
    'address_neighborhood','address_city','address_state',
    'service_delivery','service_pickup','delivery_fee','delivery_radius_km',
    'delivery_fee_method','minimum_order_value','free_delivery_threshold',
    'estimated_delivery_min_minutes','estimated_delivery_max_minutes','latitude','longitude',
    'payment_pix','payment_pix_key','payment_pix_key_type','payment_pix_holder_name',
    'payment_pix_city','payment_cash','payment_card',
    'logo_path','cover_path','theme_primary_color','contact_whatsapp','contact_email','bio'];
  system_cols text[] := array['id', 'created_at', 'updated_at'];
  profile_protected text[] := array['id','user_id','created_at','updated_at','document',
                                    'trial_started_at','trial_ends_at','trial_status','is_master'];
  personas text[] := array['owner_a','staff_a','owner_b','master','anon'];

  c record; n bigint; ok boolean; err text; v_ok boolean; v_phase int;
  col text; p text; i int;
  fails text[] := '{}'; notes text[] := '{}'; total int := 0;
  w text;  -- token do webhook
begin
  -- ---------- setup (como dono do banco) ----------
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_owner_a, 'owner-a@iso.test', jsonb_build_object('name','Owner A','phone','11999990001','document','52998224725')),
    (u_staff_a, 'staff-a@iso.test', jsonb_build_object('name','Staff A','phone','11999990002','document','11144477735')),
    (u_owner_b, 'owner-b@iso.test', jsonb_build_object('name','Owner B','phone','11999990003','document','39053344705')),
    (u_master,  'master@iso.test',  jsonb_build_object('name','Master','phone','11999990004','document','12345678909'));

  insert into public.restaurants (name, slug) values ('Loja A', 'iso-billing-a') returning id into r_a;
  insert into public.restaurants (name, slug) values ('Loja B', 'iso-billing-b') returning id into r_b;
  insert into public.restaurant_members (restaurant_id, user_id, role) values
    (r_a, u_owner_a, 'OWNER'), (r_a, u_staff_a, 'STAFF'), (r_b, u_owner_b, 'OWNER');
  update public.profiles set is_master = true where user_id = u_master;
  insert into public.plans (name, price) values ('Plano Teste Isolamento', 49.90) returning id into v_plan;
  w := repeat('t', 40);
  update public.billing_settings set asaas_webhook_token = w where id = true;
  -- baseline da loja A: assinatura cancelada, sem plano nem IDs do Asaas
  update public.restaurants set subscription_status = 'cancelled' where id = r_a;

  protected_vals := array[format('%L::uuid', v_plan), '''active''', '''cus_hack''', '''sub_hack''',
                          'now() + interval ''365 days'''];

  create temp table _cases (
    ord serial, phase int, persona text, expect text, needle text,
    label text, stmt text, verify text
  ) on commit drop;

  -- ============================================================
  -- FASE 0 — catálogo
  -- ============================================================
  insert into _cases (phase, persona, expect, label, stmt, verify) values
   (0,'sys','check','sem UPDATE de TABELA inteira em restaurants para authenticated/anon','select 1',
    $v$ not has_table_privilege('authenticated','public.restaurants','UPDATE')
        and not has_table_privilege('anon','public.restaurants','UPDATE') $v$),
   (0,'sys','check','sem UPDATE de TABELA inteira em profiles para authenticated/anon','select 1',
    $v$ not has_table_privilege('authenticated','public.profiles','UPDATE')
        and not has_table_privilege('anon','public.profiles','UPDATE') $v$),
   (0,'sys','check','trigger de guarda existe e esta ativo','select 1',
    $v$ exists (select 1 from pg_trigger where tgrelid = 'public.restaurants'::regclass
                and tgname = 'restaurants_guard_billing_columns' and tgenabled = 'O') $v$),
   (0,'sys','check','toda coluna de restaurants esta classificada (operacional, cobranca ou sistema)','select 1',
    format($v$ not exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'restaurants'
                  and column_name <> all (%L::text[])) $v$,
           (protected_cols || operational_cols || system_cols)::text));

  foreach col in array protected_cols loop
    insert into _cases (phase, persona, expect, label, stmt, verify) values
     (0,'sys','check', format('coluna de cobranca %s NAO e gravavel por authenticated/anon', col), 'select 1',
      format($v$ not has_column_privilege('authenticated','public.restaurants',%L,'UPDATE')
                 and not has_column_privilege('anon','public.restaurants',%L,'UPDATE') $v$, col, col));
  end loop;
  foreach col in array system_cols loop
    insert into _cases (phase, persona, expect, label, stmt, verify) values
     (0,'sys','check', format('coluna de sistema %s NAO e gravavel por authenticated', col), 'select 1',
      format($v$ not has_column_privilege('authenticated','public.restaurants',%L,'UPDATE') $v$, col));
  end loop;
  foreach col in array operational_cols loop
    insert into _cases (phase, persona, expect, label, stmt, verify) values
     (0,'sys','check', format('coluna operacional %s continua gravavel por authenticated', col), 'select 1',
      format($v$ has_column_privilege('authenticated','public.restaurants',%L,'UPDATE') $v$, col));
  end loop;
  foreach col in array profile_protected loop
    insert into _cases (phase, persona, expect, label, stmt, verify) values
     (0,'sys','check', format('profiles.%s (trial/identidade/master) NAO e gravavel por authenticated', col), 'select 1',
      format($v$ not has_column_privilege('authenticated','public.profiles',%L,'UPDATE') $v$, col));
  end loop;

  -- ============================================================
  -- FASE 1 — ataques e controles positivos
  -- ============================================================
  -- 1a. colunas de cobranca: nenhuma persona consegue (OWNER, STAFF, outra
  --     loja, master sem RPC, anon). Esperado: barrado pelo PRIVILEGIO.
  foreach p in array personas loop
    for i in 1..array_length(protected_cols, 1) loop
      insert into _cases (phase, persona, expect, needle, label, stmt) values
       (1, p, 'deny', 'permission denied',
        format('%s NAO altera restaurants.%s', p, protected_cols[i]),
        format('update public.restaurants set %I = %s where id = %L', protected_cols[i], protected_vals[i], r_a));
    end loop;
  end loop;

  insert into _cases (phase, persona, expect, needle, label, stmt) values
   (1,'owner_a','deny','permission denied','UPDATE misto (bio + subscription_status) e recusado inteiro',
    format($s$ update public.restaurants set bio = 'mixed-hack', subscription_status = 'active' where id = %L $s$, r_a)),
   (1,'owner_a','deny','permission denied','OWNER NAO altera id',
    format('update public.restaurants set id = gen_random_uuid() where id = %L', r_a)),
   (1,'owner_a','deny','permission denied','OWNER NAO altera created_at',
    format($s$ update public.restaurants set created_at = now() - interval '5 years' where id = %L $s$, r_a)),
   (1,'owner_a','deny','permission denied','OWNER NAO altera updated_at',
    format($s$ update public.restaurants set updated_at = now() - interval '5 years' where id = %L $s$, r_a)),
   (1,'owner_a','deny',null,'OWNER NAO cria restaurante por INSERT direto',
    $s$ insert into public.restaurants (name, slug) values ('hack', 'iso-hack-x') $s$),
   (1,'owner_a','deny',null,'OWNER NAO apaga restaurante',
    format('delete from public.restaurants where id = %L', r_a)),
   (1,'anon','deny',null,'anon NAO cria restaurante por INSERT direto',
    $s$ insert into public.restaurants (name, slug) values ('hack', 'iso-hack-y') $s$),
   (1,'anon','deny',null,'anon NAO apaga restaurante',
    format('delete from public.restaurants where id = %L', r_a));

  -- 1b. trial e identidade (profiles)
  foreach p in array array['owner_a','staff_a'] loop
    insert into _cases (phase, persona, expect, needle, label, stmt)
    select 1, p, 'deny', 'permission denied', format('%s NAO altera profiles.%s', p, v.col),
           format('update public.profiles set %I = %s where user_id = %L', v.col, v.val,
                  case p when 'owner_a' then u_owner_a else u_staff_a end)
    from (values ('trial_ends_at', 'now() + interval ''365 days'''),
                 ('trial_started_at', 'now()'),
                 ('trial_status', '''active'''),
                 ('is_master', 'true'),
                 ('document', '''98765432100''')) as v(col, val);
  end loop;
  insert into _cases (phase, persona, expect, needle, label, stmt) values
   (1,'owner_a','deny',null,'usuario NAO cria 2o profile com is_master (user_id unico)',
    format('insert into public.profiles (user_id, is_master) values (%L, true)', u_owner_a)),
   (1,'owner_a','deny',null,'usuario NAO apaga o proprio profile',
    format('delete from public.profiles where user_id = %L', u_owner_a)),
   (1,'owner_a','deny',null,'usuario NAO altera profile de outro usuario',
    format($s$ update public.profiles set name = 'hack' where user_id = %L $s$, u_owner_b));
  insert into _cases (phase, persona, expect, label, stmt, verify) values
   (1,'owner_a','allow','CONTROLE: usuario altera o proprio name em profiles',
    format($s$ update public.profiles set name = 'Owner A Editado' where user_id = %L $s$, u_owner_a),
    format($v$ (select name from public.profiles where user_id = %L) = 'Owner A Editado' $v$, u_owner_a));

  -- 1c. outra loja / anon nao tocam em dados operacionais da loja A
  insert into _cases (phase, persona, expect, label, stmt) values
   (1,'owner_b','deny','OWNER da loja B NAO altera bio da loja A',
    format($s$ update public.restaurants set bio = 'cross' where id = %L $s$, r_a)),
   (1,'staff_a','deny','STAFF da loja A NAO altera a loja B',
    format($s$ update public.restaurants set bio = 'cross' where id = %L $s$, r_b)),
   (1,'anon','deny','anon NAO altera bio de restaurante',
    format($s$ update public.restaurants set bio = 'cross' where id = %L $s$, r_a));

  -- 1d. as tentativas acima nao mudaram nada (verificacao como dono do banco)
  insert into _cases (phase, persona, expect, label, stmt, verify) values
   (1,'sys','check','apos os ataques: cobranca da loja A segue no baseline e nada vazou','select 1',
    format($v$ (select plan_id is null and subscription_status = 'cancelled'
                       and asaas_customer_id is null and asaas_subscription_id is null
                       and subscription_current_period_end is null
                       and bio is distinct from 'mixed-hack' and bio is distinct from 'cross'
                       and name = 'Loja A' and id = %L
                from public.restaurants where id = %L)
              and (select bio is distinct from 'cross' from public.restaurants where id = %L)
              and (select trial_ends_at > now() + interval '20 days' and trial_ends_at < now() + interval '40 days'
                          and not is_master
                   from public.profiles where user_id = %L) $v$, r_a, r_a, r_b, u_owner_a));

  -- 1e. CONTROLE POSITIVO: o OWNER continua editando tudo que e operacional
  insert into _cases (phase, persona, expect, label, stmt, verify) values
   (1,'owner_a','allow','CONTROLE: OWNER edita nome, slug e informacoes',
    format($s$ update public.restaurants set name = 'Loja A Editada', slug = 'iso-billing-a2', bio = 'Bio de teste',
              contact_whatsapp = '11999990000', contact_email = 'a@loja.test', theme_primary_color = '#112233' where id = %L $s$, r_a),
    format($v$ (select name = 'Loja A Editada' and slug = 'iso-billing-a2' and bio = 'Bio de teste'
                       and theme_primary_color = '#112233' from public.restaurants where id = %L) $v$, r_a)),
   (1,'owner_a','allow','CONTROLE: OWNER edita endereco',
    format($s$ update public.restaurants set address_zip = '01000000', address_street = 'Rua A', address_number = '10',
              address_complement = null, address_neighborhood = 'Centro', address_city = 'Sao Paulo', address_state = 'SP' where id = %L $s$, r_a),
    format($v$ (select address_city = 'Sao Paulo' from public.restaurants where id = %L) $v$, r_a)),
   (1,'owner_a','allow','CONTROLE: OWNER edita delivery e frete',
    format($s$ update public.restaurants set service_delivery = true, service_pickup = true, delivery_fee = 5,
              delivery_radius_km = 8, delivery_fee_method = 'per_km', minimum_order_value = 20, free_delivery_threshold = 80,
              estimated_delivery_min_minutes = 20, estimated_delivery_max_minutes = 40, latitude = -23.5, longitude = -46.6 where id = %L $s$, r_a),
    format($v$ (select delivery_fee_method = 'per_km' and delivery_fee = 5 from public.restaurants where id = %L) $v$, r_a)),
   (1,'owner_a','allow','CONTROLE: OWNER edita formas de pagamento da loja (Pix, dinheiro, cartao)',
    format($s$ update public.restaurants set payment_pix = true, payment_pix_key = 'chave-teste', payment_pix_key_type = 'aleatoria',
              payment_pix_holder_name = 'Titular', payment_pix_city = 'SAO PAULO', payment_cash = true, payment_card = true where id = %L $s$, r_a),
    format($v$ (select payment_pix_key = 'chave-teste' from public.restaurants where id = %L) $v$, r_a)),
   (1,'owner_a','allow','CONTROLE: OWNER edita logo e capa',
    format($s$ update public.restaurants set logo_path = 'a/logo.png', cover_path = 'a/cover.png' where id = %L $s$, r_a),
    format($v$ (select logo_path = 'a/logo.png' from public.restaurants where id = %L) $v$, r_a)),
   (1,'owner_a','allow','CONTROLE: OWNER pausa a loja e avanca o onboarding',
    format($s$ update public.restaurants set status = 'paused', onboarding_step = 3, onboarding_completed = true where id = %L $s$, r_a),
    format($v$ (select status = 'paused' and onboarding_step = 3 from public.restaurants where id = %L) $v$, r_a)),
   (1,'sys','check','apos as edicoes operacionais a cobranca continua intacta','select 1',
    format($v$ (select plan_id is null and subscription_status = 'cancelled' and asaas_subscription_id is null
                from public.restaurants where id = %L) $v$, r_a));

  -- ============================================================
  -- FASE 2 — fluxos legitimos de trial e cobranca
  -- ============================================================
  insert into _cases (phase, persona, expect, label, stmt, verify) values
   (2,'sys','allow','prepara: sem plano, assinatura "active" padrao, trial do dono vencido',
    format($s$ update public.restaurants set subscription_status = 'active', plan_id = null, asaas_customer_id = null,
              asaas_subscription_id = null, subscription_current_period_end = null where id = %L $s$, r_a),
    null),
   (2,'sys','allow','prepara: trial do OWNER vencido',
    format($s$ update public.profiles set trial_ends_at = now() - interval '1 day' where user_id = %L $s$, u_owner_a),
    format($v$ public._restaurant_access_state(%L) = 'trial_expired' $v$, r_a)),
   (2,'owner_a','deny','OWNER com trial vencido NAO se libera setando plano e status',
    format($s$ update public.restaurants set plan_id = %L, subscription_status = 'active' where id = %L $s$, v_plan, r_a),
    format($v$ public._restaurant_access_state(%L) = 'trial_expired' $v$, r_a)),
   (2,'staff_a','deny','STAFF com trial vencido NAO se libera setando o status',
    format($s$ update public.restaurants set subscription_status = 'active' where id = %L $s$, r_a),
    format($v$ public._restaurant_access_state(%L) = 'trial_expired' $v$, r_a)),
   (2,'owner_a','deny','OWNER NAO prorroga o proprio trial (profiles)',
    format($s$ update public.profiles set trial_ends_at = now() + interval '365 days' where user_id = %L $s$, u_owner_a),
    format($v$ public._restaurant_access_state(%L) = 'trial_expired' $v$, r_a)),
   (2,'master','allow','FLUXO LEGITIMO: master concede cortesia de trial (RPC)',
    format('select public.master_extend_trial(%L, 7)', r_a),
    format($v$ public._restaurant_access_state(%L) is null $v$, r_a)),
   (2,'sys','allow','prepara: trial vencido de novo para isolar o fluxo de assinatura',
    format($s$ update public.profiles set trial_ends_at = now() - interval '1 day' where user_id = %L $s$, u_owner_a),
    format($v$ public._restaurant_access_state(%L) = 'trial_expired' $v$, r_a)),
   (2,'staff_a','deny','STAFF NAO inicia assinatura (RPC exige OWNER)',
    format('select public.start_restaurant_subscription(%L, %L, %L)', v_plan, 'cus_staff', 'sub_staff'),
    format($v$ (select plan_id is null and asaas_subscription_id is null from public.restaurants where id = %L) $v$, r_a)),
   (2,'owner_a','allow','FLUXO LEGITIMO: OWNER inicia a assinatura pela RPC',
    format('select public.start_restaurant_subscription(%L, %L, %L)', v_plan, 'cus_ok', 'sub_ok'),
    format($v$ (select plan_id = %L and subscription_status = 'pending' and asaas_customer_id = 'cus_ok'
                       and asaas_subscription_id = 'sub_ok' from public.restaurants where id = %L)
               and public._restaurant_access_state(%L) is null $v$, v_plan, r_a, r_a)),
   (2,'anon','allow','FLUXO LEGITIMO: webhook marca atraso (token correto)',
    format('select public.process_asaas_webhook(%L, %L, %L, %L, %L)', w, 'evt-1', 'PAYMENT_OVERDUE', 'sub_ok', 'overdue'),
    format($v$ (select subscription_status = 'overdue' from public.restaurants where id = %L)
               and public._restaurant_access_state(%L) = 'overdue' $v$, r_a, r_a)),
   (2,'anon','deny','webhook com token errado e recusado e nao muda nada',
    format('select public.process_asaas_webhook(%L, %L, %L, %L, %L)', 'token-errado', 'evt-x', 'PAYMENT_CONFIRMED', 'sub_ok', 'active'),
    format($v$ (select subscription_status = 'overdue' from public.restaurants where id = %L) $v$, r_a)),
   (2,'anon','allow','FLUXO LEGITIMO: pagamento confirmado reativa a loja',
    format('select public.process_asaas_webhook(%L, %L, %L, %L, %L)', w, 'evt-2', 'PAYMENT_CONFIRMED', 'sub_ok', 'active'),
    format($v$ (select subscription_status = 'active' from public.restaurants where id = %L)
               and public._restaurant_access_state(%L) is null $v$, r_a, r_a)),
   (2,'anon','allow','FLUXO LEGITIMO: webhook cancela a assinatura',
    format('select public.process_asaas_webhook(%L, %L, %L, %L, %L)', w, 'evt-3', 'SUBSCRIPTION_DELETED', 'sub_ok', 'cancelled'),
    format($v$ (select subscription_status = 'cancelled' from public.restaurants where id = %L)
               and public._restaurant_access_state(%L) = 'cancelled' $v$, r_a, r_a)),
   (2,'owner_a','deny','loja cancelada: OWNER NAO se reativa por UPDATE direto',
    format($s$ update public.restaurants set subscription_status = 'active' where id = %L $s$, r_a),
    format($v$ public._restaurant_access_state(%L) = 'cancelled' $v$, r_a)),
   (2,'master','allow','FLUXO LEGITIMO: usuario sem loja cria o restaurante pela RPC create_restaurant',
    $s$ select public.create_restaurant('Loja Nova', 'iso-billing-nova') $s$,
    $v$ (select subscription_status = 'active' and plan_id is null and status = 'draft'
         from public.restaurants where slug = 'iso-billing-nova') $v$);

  -- ============================================================
  -- FASE 3 — segunda camada: o GRANT e reaberto por engano (simulado)
  -- ============================================================
  insert into _cases (phase, persona, expect, label, stmt, verify) values
   (3,'sys','check','simulacao ativa: authenticated voltou a ter UPDATE de tabela inteira','select 1',
    $v$ has_table_privilege('authenticated','public.restaurants','UPDATE') $v$);
  insert into _cases (phase, persona, expect, needle, label, stmt, verify) values
   -- nota: nesta fase a loja A ja tem plan_id = v_plan (fluxo legitimo da fase 2);
   -- gravar o mesmo valor seria um no-op, entao o ataque tenta REMOVER o plano.
   (3,'owner_a','deny','billing_columns_protected','mesmo com GRANT amplo, o trigger barra OWNER (plan_id)',
    format('update public.restaurants set plan_id = null where id = %L', r_a),
    format($v$ (select plan_id = %L and subscription_status = 'cancelled' from public.restaurants where id = %L) $v$, v_plan, r_a)),
   (3,'staff_a','deny','billing_columns_protected','mesmo com GRANT amplo, o trigger barra STAFF (subscription_status)',
    format($s$ update public.restaurants set subscription_status = 'active' where id = %L $s$, r_a),
    format($v$ (select subscription_status = 'cancelled' from public.restaurants where id = %L) $v$, r_a)),
   (3,'owner_a','deny','billing_columns_protected','mesmo com GRANT amplo, o trigger barra asaas_subscription_id',
    format($s$ update public.restaurants set asaas_subscription_id = 'sub_hack' where id = %L $s$, r_a), null),
   (3,'owner_a','deny','billing_columns_protected','mesmo com GRANT amplo, o trigger barra subscription_current_period_end',
    format($s$ update public.restaurants set subscription_current_period_end = now() + interval '1 year' where id = %L $s$, r_a), null),
   (3,'owner_a','allow',null,'CONTROLE: com GRANT amplo, edicao operacional segue funcionando',
    format($s$ update public.restaurants set bio = 'pos-regrant' where id = %L $s$, r_a),
    format($v$ (select bio = 'pos-regrant' from public.restaurants where id = %L) $v$, r_a)),
   (3,'owner_a','allow',null,'FLUXO LEGITIMO: re-assinatura apos cancelamento passa pelo trigger (RPC definer)',
    format('select public.start_restaurant_subscription(%L, %L, %L)', v_plan, 'cus_2', 'sub_2'),
    format($v$ (select asaas_subscription_id = 'sub_2' and subscription_status = 'pending' from public.restaurants where id = %L) $v$, r_a)),
   (3,'anon','allow',null,'FLUXO LEGITIMO: webhook passa pelo trigger (RPC definer)',
    format('select public.process_asaas_webhook(%L, %L, %L, %L, %L)', w, 'evt-4', 'PAYMENT_CONFIRMED', 'sub_2', 'active'),
    format($v$ (select subscription_status = 'active' from public.restaurants where id = %L) $v$, r_a));

  -- ---------- execucao ----------
  for v_phase in 0..3 loop
    if v_phase = 3 then
      reset role;
      execute 'grant update on public.restaurants to authenticated';  -- simula a regressao
    end if;

    for c in select * from _cases where phase = v_phase order by ord loop
      total := total + 1;
      reset role;
      if c.persona <> 'sys' then
        perform set_config('request.jwt.claims',
          case c.persona when 'anon' then ''
            else json_build_object('sub',
              case c.persona when 'owner_a' then u_owner_a when 'staff_a' then u_staff_a
                             when 'owner_b' then u_owner_b when 'master' then u_master else u_stranger end,
              'role', 'authenticated')::text end, true);
        execute format('set local role %I', case when c.persona = 'anon' then 'anon' else 'authenticated' end);
      end if;

      ok := false; err := null; n := 0;
      begin
        execute c.stmt;
        get diagnostics n = row_count;
        ok := n > 0;
      exception when others then
        ok := false; err := sqlerrm;
      end;
      reset role;

      if c.expect = 'deny' then
        if c.needle is not null then
          if err is null or position(c.needle in err) = 0 then
            fails := fails || format('%s (nao barrado pela camada esperada "%s": %s)',
                                     c.label, c.needle, coalesce(err, 'EXECUTOU SEM ERRO'));
          end if;
        elsif ok then
          fails := fails || format('%s (FOI PERMITIDO)', c.label);
        end if;
      elsif c.expect = 'allow' then
        if not ok then
          fails := fails || format('%s (foi negado: %s)', c.label, coalesce(err, '0 linhas afetadas'));
        end if;
      end if;

      if c.verify is not null then
        begin
          execute 'select coalesce((' || c.verify || '), false)' into v_ok;
        exception when others then
          v_ok := false;
          fails := fails || format('%s (verificacao com erro: %s)', c.label, sqlerrm);
        end;
        if not v_ok then
          fails := fails || format('%s (verificacao FALHOU)', c.label);
        end if;
      end if;
    end loop;
  end loop;

  -- ---------- papel MANAGER nao existe ----------
  total := total + 1;
  begin
    insert into public.restaurant_members (restaurant_id, user_id, role) values (r_b, u_master, 'MANAGER');
    fails := fails || 'papel MANAGER passou a existir: estender estes testes a ele'::text;
  exception when check_violation then
    notes := notes || 'MANAGER nao existe (check de restaurant_members.role); protecao vale por role de banco'::text;
  end;

  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes | notas: %', total, array_to_string(notes, ' ; ');
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %  || notas: %', array_length(fails, 1), total,
      array_to_string(fails, ' ## '), coalesce(array_to_string(notes, ' ; '), '-');
  end if;
end $$;
