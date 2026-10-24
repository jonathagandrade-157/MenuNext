-- MenuNext — teste de regressão da cobrança de assinaturas (P1-01): acesso pago
-- só com pagamento confirmado por evento autenticado do provedor.
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO (local, branch do Supabase ou banco de
-- teste). O script cria usuários em auth.users e usa funções temporárias
-- (pg_temp). Tudo que grava fica dentro de UM bloco DO que SEMPRE termina com
-- `raise exception`, então nada persiste, mas NÃO use contra a produção.
--
-- Como ler o resultado: a mensagem final do erro é o relatório.
--   RESULTADO: OK | N verificacoes            -> tudo protegido
--   RESULTADO: FALHOU (k) | N verificacoes | ... -> lista cada violação
--
-- Cenários:
--   S1  ID inventado / forjado            S2  cobrança pendente e pagamento confirmado
--   S3  atraso, renovação, estorno        S3b chargeback, prorrogação e restauração
--   S4  cancelamento e nova assinatura    S5  evento fora de ordem / antes do registro
--   S6  manipulação por OWNER/STAFF e isolamento entre restaurantes
--   S7  webhook inválido                  S8  catálogo e restrições do banco
--   S9  pronto para vários provedores     S10 período pago após cancelamento e bloqueio
--   S11 reconciliação com a API           S12 checkout dos clientes não é afetado
-- Nenhuma credencial nem pagamento real: o "Asaas" é simulado por chamadas às
-- RPCs com o token de teste definido aqui; o "backend" é a persona service_role.

drop table if exists pg_temp._ck;
create temp table _ck (ord serial, label text, ok boolean);

create or replace function pg_temp._ck(p_label text, p_ok boolean) returns void
language sql as $$ insert into _ck (label, ok) values (p_label, coalesce(p_ok, false)) $$;

-- Executa p_stmt com um role (anon/authenticated/service_role) e devolve a 1a coluna
-- como texto, ou 'ERR: <mensagem>' se falhar. Sempre volta ao papel do dono do banco.
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

-- Persona de usuario (null = anon).
create or replace function pg_temp._run(p_uid uuid, p_stmt text) returns text
language sql as $$
  select pg_temp._runas(case when p_uid is null then 'anon' else 'authenticated' end, p_uid, p_stmt)
$$;

-- O backend (service_role).
create or replace function pg_temp._svc(p_stmt text) returns text
language sql as $$ select pg_temp._runas('service_role', null, p_stmt) $$;

-- CPF válido determinístico (cada loja de teste precisa de um documento único).
create or replace function pg_temp._cpf(n int) returns text language plpgsql as $$
declare base text := lpad((123456000 + n * 37)::text, 9, '0'); s int := 0; d1 int; d2 int; i int;
begin
  for i in 1..9 loop s := s + substr(base, i, 1)::int * (11 - i); end loop;
  d1 := (s * 10) % 11; if d1 = 10 then d1 := 0; end if;
  s := 0;
  for i in 1..9 loop s := s + substr(base, i, 1)::int * (12 - i); end loop;
  s := s + d1 * 2;
  d2 := (s * 10) % 11; if d2 = 10 then d2 := 0; end if;
  return base || d1::text || d2::text;
end $$;

-- Cria dono + restaurante; devolve array[user_id, restaurant_id].
create or replace function pg_temp._store(p_key int, p_trial_expired boolean) returns uuid[]
language plpgsql as $$
declare v_uid uuid := gen_random_uuid(); v_rid uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values (v_uid, 'billing-' || p_key || '@sub.test',
    jsonb_build_object('name', 'Dono ' || p_key, 'phone', '1199' || lpad(p_key::text, 7, '0'), 'document', pg_temp._cpf(p_key)));
  insert into public.restaurants (name, slug) values ('Loja ' || p_key, 'sub-billing-' || p_key) returning id into v_rid;
  insert into public.restaurant_members (restaurant_id, user_id, role) values (v_rid, v_uid, 'OWNER');
  if p_trial_expired then
    update public.profiles set trial_ends_at = now() - interval '1 day' where user_id = v_uid;
  end if;
  return array[v_uid, v_rid];
end $$;

-- Fluxo legítimo: o OWNER abre a assinatura; o BACKEND (service_role) registra os ids
-- depois de conferir o valor. Devolve 'OK' ou o erro.
create or replace function pg_temp._subscribe(p_uid uuid, p_plan uuid, p_cus text, p_sub text, p_amount numeric default 49.90)
returns text language plpgsql as $$
declare v_id text; v_res text;
begin
  v_id := pg_temp._run(p_uid, format('select out_subscription_id::text from public.billing_begin_subscription(%L)', p_plan));
  if v_id like 'ERR:%' then return v_id; end if;
  v_res := pg_temp._svc(format('select public.billing_attach_provider_subscription(%L, %L, %L, %L)::text', v_id, p_cus, p_sub, p_amount));
  return coalesce(nullif(v_res, ''), 'OK');
end $$;

-- Evento do "Asaas" (chega como anon, autenticado só pelo token).
create or replace function pg_temp._wh(p_token text, p_evt text, p_type text, p_sub text, p_cus text,
                                       p_pay text, p_val numeric, p_due date default null, p_ext text default null,
                                       p_occ timestamptz default null)
returns text language sql as $$
  select pg_temp._run(null, format('select public.process_asaas_webhook(%L, %L, %L, %L, %L, %L, %L, %L, %L, null, %L)',
                                   p_token, p_evt, p_type, p_occ, p_sub, p_cus, p_pay, p_val, p_due, p_ext))
$$;

-- Leitura da API (reconciliação) feita pelo backend.
create or replace function pg_temp._rec(p_sub text, p_cus text, p_pay text, p_status text, p_val numeric,
                                        p_due date default null, p_deleted boolean default false)
returns text language sql as $$
  select pg_temp._svc(format('select public.billing_reconcile_payment(%L, %L, %L, %L, %L, %L, %L, %L, null)',
                             'asaas', p_sub, p_cus, p_pay, p_status, p_deleted, p_val, p_due))
$$;

-- Pedido anônimo no checkout público.
create or replace function pg_temp._order(p_slug text, p_prod uuid, p_key text) returns text
language sql as $$
  select pg_temp._run(null, format('select count(*)::text from public.create_order(%L, %L, %L, %L, %L, %L::jsonb, %L)',
    p_slug, 'Cliente', '11999999999', 'pickup', 'cash',
    jsonb_build_array(jsonb_build_object('product_id', p_prod, 'quantity', 1))::text, p_key))
$$;

do $$
declare
  w text := repeat('w', 40);
  v_plan uuid; v_plan_off uuid; v_plan_free uuid;
  sa uuid[]; sc uuid[]; sd uuid[]; se uuid[]; sf uuid[]; sg uuid[]; sh uuid[]; sb uuid[];
  si uuid[]; sj uuid[]; sk uuid[]; sl uuid[]; sm uuid[]; sn uuid[]; so uuid[]; sp uuid[]; sq uuid[];
  u_staff uuid := gen_random_uuid(); u_master uuid := gen_random_uuid(); u_stranger uuid := gen_random_uuid();
  r text; r2 text; v_id text; n bigint; v_cat uuid; v_prod uuid; v_slug text;
  h1 text; h2 text; h3 text;
  fails text[] := '{}'; total int := 0; c record;
begin
  -- ---------- setup (como dono do banco) ----------
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_staff,    'billing-staff@sub.test',    jsonb_build_object('name','Staff','phone','11999990501','document', pg_temp._cpf(901))),
    (u_master,   'billing-master@sub.test',   jsonb_build_object('name','Master','phone','11999990502','document', pg_temp._cpf(902))),
    (u_stranger, 'billing-stranger@sub.test', jsonb_build_object('name','Sem loja','phone','11999990503','document', pg_temp._cpf(903)));
  update public.profiles set is_master = true where user_id = u_master;

  insert into public.plans (name, price) values ('Plano P1-01', 49.90) returning id into v_plan;
  insert into public.plans (name, price, is_active) values ('Plano Inativo P1-01', 29.90, false) returning id into v_plan_off;
  insert into public.plans (name, price) values ('Plano Gratis P1-01', 0) returning id into v_plan_free;
  update public.billing_settings set asaas_webhook_token = w where id = true;

  sa := pg_temp._store(1, true);   -- S1: ID inventado
  sb := pg_temp._store(2, true);   -- S6: outro restaurante, sem assinatura
  sc := pg_temp._store(3, true);   -- S2/S3: fluxo real, estorno
  sd := pg_temp._store(4, true);   -- S4: cancelamento e nova assinatura
  se := pg_temp._store(5, false);  -- S3: trial em vigor (cortesias preservadas)
  sf := pg_temp._store(6, true);   -- S5: evento antes do registro
  sg := pg_temp._store(7, true);   -- S4: cancelar antes de pagar
  sh := pg_temp._store(8, true);   -- S6: tentativas de manipulacao
  si := pg_temp._store(9, true);   -- S3b: chargeback
  sj := pg_temp._store(10, true);  -- S3b: prorrogacao e restauracao
  sk := pg_temp._store(11, true);  -- S10: cancelada dentro do periodo pago
  sl := pg_temp._store(12, true);  -- S10: estorno apos cancelar
  sm := pg_temp._store(13, true);  -- S10: bloqueio administrativo
  sn := pg_temp._store(14, true);  -- S11: webhook perdido
  so := pg_temp._store(15, true);  -- S11: confirmacao forjada corrigida
  sp := pg_temp._store(16, false); -- S12: checkout
  sq := pg_temp._store(17, true);  -- S11: lista de reconciliacao
  insert into public.restaurant_members (restaurant_id, user_id, role) values (sh[2], u_staff, 'STAFF');

  -- ============================================================
  -- S1 — ID inventado não libera nada
  -- ============================================================
  perform pg_temp._ck('S1 baseline: loja com trial vencido esta bloqueada (trial_expired)',
    public._restaurant_access_state(sa[2]) = 'trial_expired');

  r := pg_temp._run(sa[1], format('select out_subscription_id::text from public.billing_begin_subscription(%L)', v_plan));
  perform pg_temp._ck('S1 OWNER abre a assinatura e recebe o id interno', r not like 'ERR:%' and r is not null);
  perform pg_temp._ck('S1 abrir a assinatura NAO altera o espelho (plan_id continua nulo)',
    (select plan_id is null and subscription_status = 'active' from public.restaurants where id = sa[2]));
  perform pg_temp._ck('S1 assinatura aberta fica "initiated", com valor/moeda do PLANO (49.90 BRL)',
    exists (select 1 from public.billing_subscriptions where id = r::uuid and status = 'initiated'
            and amount = 49.90 and currency = 'BRL' and provider = 'asaas' and plan_id = v_plan));
  r2 := pg_temp._run(sa[1], format('select out_subscription_id::text from public.billing_begin_subscription(%L)', v_plan));
  perform pg_temp._ck('S1 abrir de novo e idempotente (mesmo id, uma linha so)',
    r2 = r and (select count(*) from public.billing_subscriptions where restaurant_id = sa[2]) = 1);

  -- O OWNER nao consegue registrar ids (nem reais, nem inventados): so o backend
  perform pg_temp._ck('S1 OWNER NAO registra ids do provedor (inventados ou reais): so o backend',
    pg_temp._run(sa[1], format('select public.billing_attach_provider_subscription(%L, %L, %L, 49.90)::text', r, 'cus_FAKE000001', 'sub_FAKE000001')) like '%permission denied%'
    and (select status = 'initiated' and provider_subscription_id is null from public.billing_subscriptions where id = r::uuid));
  perform pg_temp._ck('S1 backend recusa valor conferido diferente do fixado no plano (amount_mismatch)',
    pg_temp._svc(format('select public.billing_attach_provider_subscription(%L, %L, %L, 1.00)::text', r, 'cus_FAKE000001', 'sub_FAKE000001')) like '%amount_mismatch%'
    and pg_temp._svc(format('select public.billing_attach_provider_subscription(%L, %L, %L, null)::text', r, 'cus_FAKE000001', 'sub_FAKE000001')) like '%amount_mismatch%');

  -- defesa em profundidade: mesmo que um registro indevido chegasse a existir (erro no
  -- backend), a assinatura so fica pending e NADA e liberado
  r2 := pg_temp._svc(format('select public.billing_attach_provider_subscription(%L, %L, %L, 49.90)::text', r, 'cus_FAKE000001', 'sub_FAKE000001'));
  perform pg_temp._ck('S1 (defesa em profundidade) registro de ids que nunca recebem eventos: so pending', r2 not like 'ERR:%'
    and (select status = 'pending' from public.billing_subscriptions where id = r::uuid));
  perform pg_temp._ck('S1 ...e a loja CONTINUA BLOQUEADA (id inventado nao libera acesso pago)',
    public._restaurant_access_state(sa[2]) = 'trial_expired');
  perform pg_temp._ck('S1 espelho mostra pending com os ids registrados',
    (select plan_id = v_plan and subscription_status = 'pending' and asaas_subscription_id = 'sub_FAKE000001'
       from public.restaurants where id = sa[2]));
  update public.billing_subscriptions set created_at = now() - interval '90 days' where id = r::uuid;
  perform pg_temp._ck('S1 mesmo 90 dias depois, pending sem pagamento NAO libera',
    public._restaurant_access_state(sa[2]) = 'trial_expired');
  perform pg_temp._ck('S1 sem cobranca confirmada nao ha periodo pago',
    (select current_period_end is null and activated_at is null from public.billing_subscriptions where id = r::uuid));

  -- formatos inválidos são recusados antes de gravar qualquer coisa
  for c in select * from (values
      ('cus_ok0000001', 'sub_1'), ('cus_ok0000001', ''), ('cus_ok0000001', null), ('', 'sub_ok0000001'),
      (null, 'sub_ok0000001'), ('xxx_ok0000001', 'sub_ok0000001'), ('cus_ok0000001', 'cus_ok0000001'),
      ('cus_ok0000001', 'sub_ok0000001; drop table x'), ('cus_ok0000001', 'sub_ok 0000001')) as t(cus, sub) loop
    v_id := (pg_temp._store(100 + (select count(*)::int from _ck), true))[2]::text;
    r2 := pg_temp._run((select user_id from public.restaurant_members where restaurant_id = v_id::uuid and role = 'OWNER'),
                       format('select out_subscription_id::text from public.billing_begin_subscription(%L)', v_plan));
    r2 := pg_temp._svc(format('select public.billing_attach_provider_subscription(%L, %L, %L, 49.90)::text', r2, c.cus, c.sub));
    perform pg_temp._ck(format('S1 formato invalido recusado: cus=%s sub=%s', c.cus, c.sub),
      r2 like '%invalid_provider_reference%'
      and (select status = 'initiated' and provider_subscription_id is null from public.billing_subscriptions where restaurant_id = v_id::uuid));
  end loop;

  -- funções antigas não existem mais
  perform pg_temp._ck('S1 start_restaurant_subscription (antiga) foi removida',
    pg_temp._run(sa[1], format('select public.start_restaurant_subscription(%L, %L, %L)::text', v_plan, 'cus_x', 'sub_x')) like '%does not exist%');
  perform pg_temp._ck('S1 process_asaas_webhook antigo (status livre, 6 args) foi removido',
    pg_temp._run(null, format('select public.process_asaas_webhook(%L, %L, %L, %L, %L)::text', w, 'e', 'PAYMENT_CONFIRMED', 'sub_FAKE000001', 'active')) like '%does not exist%');

  -- as colunas e as tabelas de cobranca nao sao gravaveis pela API
  perform pg_temp._ck('S1 OWNER nao grava subscription_status em restaurants',
    pg_temp._run(sa[1], format($q$ update public.restaurants set subscription_status = 'active' where id = %L returning id::text $q$, sa[2])) like '%permission denied%');
  perform pg_temp._ck('S1 OWNER nao marca a assinatura como active direto na tabela',
    pg_temp._run(sa[1], format($q$ update public.billing_subscriptions set status = 'active' where restaurant_id = %L returning id::text $q$, sa[2])) like '%permission denied%');
  perform pg_temp._ck('S1 OWNER nao insere assinatura direto na tabela',
    pg_temp._run(sa[1], format($q$ insert into public.billing_subscriptions (restaurant_id, plan_id, amount, status, activated_at, provider_customer_id, provider_subscription_id)
       values (%L, %L, 1, 'active', now(), 'cus_hack0001', 'sub_hack0001') returning id::text $q$, sa[2], v_plan)) like '%permission denied%');
  perform pg_temp._ck('S1 OWNER nao insere cobranca confirmada direto na tabela',
    pg_temp._run(sa[1], format($q$ insert into public.billing_payments (subscription_id, provider, provider_payment_id, amount, status, last_event_at)
       values (%L, 'asaas', 'pay_hack0001', 49.90, 'confirmed', now()) returning id::text $q$, r)) like '%permission denied%');
  perform pg_temp._ck('S1 OWNER nao le assinaturas nem cobrancas (sem privilegio)',
    pg_temp._run(sa[1], 'select count(*)::text from public.billing_subscriptions') like '%permission denied%'
    and pg_temp._run(sa[1], 'select count(*)::text from public.billing_payments') like '%permission denied%');
  perform pg_temp._ck('S1 anon nao le assinaturas',
    pg_temp._run(null, 'select count(*)::text from public.billing_subscriptions') like '%permission denied%');

  -- ============================================================
  -- S2 — cobrança pendente e pagamento confirmado (loja C)
  -- ============================================================
  r := pg_temp._subscribe(sc[1], v_plan, 'cus_000000000C01', 'sub_000000000C01');
  perform pg_temp._ck('S2 OWNER abre e o backend registra a assinatura (fluxo legitimo)', r = 'OK');
  perform pg_temp._ck('S2 recem-registrada: pending e loja continua bloqueada',
    (select subscription_status = 'pending' from public.restaurants where id = sc[2])
    and public._restaurant_access_state(sc[2]) = 'trial_expired');

  n := (select count(*) from public.asaas_webhook_events);
  perform pg_temp._ck('S2 webhook com token ERRADO e recusado',
    pg_temp._wh('token-errado', 'evt-c-x1', 'PAYMENT_CONFIRMED', 'sub_000000000C01', 'cus_000000000C01', 'pay_000000000C01', 49.90, '2026-10-10') like '%not_authorized%');
  perform pg_temp._ck('S2 ...e nao deixa rastro no livro de eventos', (select count(*) from public.asaas_webhook_events) = n);

  h1 := pg_temp._wh(w, 'evt-c-1', 'PAYMENT_CREATED', 'sub_000000000C01', 'cus_000000000C01', 'pay_000000000C01', 49.90, '2026-10-10');
  perform pg_temp._ck('S2 PAYMENT_CREATED registra a cobranca como pending', h1 = 'applied');
  perform pg_temp._ck('S2 cobranca pendente: assinatura pending, loja bloqueada, sem periodo pago',
    (select status = 'pending' and current_period_end is null from public.billing_subscriptions where provider_subscription_id = 'sub_000000000C01')
    and public._restaurant_access_state(sc[2]) = 'trial_expired');

  perform pg_temp._ck('S2 confirmacao com VALOR MENOR que o plano e rejeitada',
    pg_temp._wh(w, 'evt-c-2', 'PAYMENT_CONFIRMED', 'sub_000000000C01', 'cus_000000000C01', 'pay_000000000C01', 10.00, '2026-10-10') = 'value_mismatch');
  perform pg_temp._ck('S2 confirmacao sem valor e rejeitada',
    pg_temp._wh(w, 'evt-c-3', 'PAYMENT_CONFIRMED', 'sub_000000000C01', 'cus_000000000C01', 'pay_000000000C01', null, '2026-10-10') = 'value_mismatch');
  perform pg_temp._ck('S2 confirmacao de OUTRO CLIENTE do provedor e rejeitada',
    pg_temp._wh(w, 'evt-c-4', 'PAYMENT_CONFIRMED', 'sub_000000000C01', 'cus_OUTRO0000001', 'pay_000000000C01', 49.90, '2026-10-10') = 'customer_mismatch');
  perform pg_temp._ck('S2 confirmacao sem cliente e rejeitada',
    pg_temp._wh(w, 'evt-c-5', 'PAYMENT_CONFIRMED', 'sub_000000000C01', null, 'pay_000000000C01', 49.90, '2026-10-10') = 'customer_mismatch');
  perform pg_temp._ck('S2 confirmacao com referencia externa de OUTRA assinatura e rejeitada',
    pg_temp._wh(w, 'evt-c-6', 'PAYMENT_CONFIRMED', 'sub_000000000C01', 'cus_000000000C01', 'pay_000000000C01', 49.90, '2026-10-10',
                '00000000-0000-4000-8000-000000000000') = 'reference_mismatch');
  perform pg_temp._ck('S2 assinatura desconhecida: evento fica registrado como unmatched, sem efeito',
    pg_temp._wh(w, 'evt-c-7', 'PAYMENT_CONFIRMED', 'sub_DESCONHECIDA1', 'cus_000000000C01', 'pay_zzz0000001', 49.90, '2026-10-10') = 'unmatched');
  perform pg_temp._ck('S2 nenhuma das tentativas invalidas liberou a loja',
    (select status = 'pending' from public.billing_subscriptions where provider_subscription_id = 'sub_000000000C01')
    and public._restaurant_access_state(sc[2]) = 'trial_expired'
    and not exists (select 1 from public.billing_payments where provider_payment_id = 'pay_000000000C01' and status = 'confirmed'));

  h1 := pg_temp._wh(w, 'evt-c-8', 'PAYMENT_CONFIRMED', 'sub_000000000C01', 'cus_000000000C01', 'pay_000000000C01', 49.90, '2026-10-10',
                    (select id::text from public.billing_subscriptions where provider_subscription_id = 'sub_000000000C01'));
  perform pg_temp._ck('S2 PAYMENT_CONFIRMED valido (referencia correta, valor do plano) e aplicado', h1 = 'applied');
  perform pg_temp._ck('S2 pagamento confirmado: assinatura ACTIVE, ativada, loja LIBERADA, espelho active',
    (select status = 'active' and activated_at is not null from public.billing_subscriptions where provider_subscription_id = 'sub_000000000C01')
    and (select subscription_status = 'active' and plan_id = v_plan from public.restaurants where id = sc[2])
    and public._restaurant_access_state(sc[2]) is null);
  perform pg_temp._ck('S2 periodo pago termina um mes apos o vencimento (2026-11-10, horario de Brasilia)',
    (select current_period_end = timestamptz '2026-11-10 00:00:00-03' from public.billing_subscriptions where provider_subscription_id = 'sub_000000000C01'));

  h1 := pg_temp._wh(w, 'evt-c-9', 'PAYMENT_RECEIVED', 'sub_000000000C01', 'cus_000000000C01', 'pay_000000000C01', 49.90, '2026-10-10');
  perform pg_temp._ck('S2 PAYMENT_RECEIVED da MESMA cobranca (outro evento) e no-op: uma linha so, mesmo periodo',
    h1 = 'noop' and (select count(*) from public.billing_payments where provider_payment_id = 'pay_000000000C01') = 1
    and (select current_period_end = timestamptz '2026-11-10 00:00:00-03' from public.billing_subscriptions where provider_subscription_id = 'sub_000000000C01'));
  h1 := pg_temp._wh(w, 'evt-c-8', 'PAYMENT_CONFIRMED', 'sub_000000000C01', 'cus_000000000C01', 'pay_000000000C01', 49.90, '2026-10-10');
  perform pg_temp._ck('S2 MESMO evento reenviado (duplicado) e ignorado', h1 = 'duplicate');
  perform pg_temp._ck('S2 duplicado nao soma periodo nem cria cobranca',
    (select count(*) from public.billing_payments p join public.billing_subscriptions b on b.id = p.subscription_id
       where b.provider_subscription_id = 'sub_000000000C01') = 1
    and (select current_period_end = timestamptz '2026-11-10 00:00:00-03' from public.billing_subscriptions where provider_subscription_id = 'sub_000000000C01'));
  h1 := pg_temp._wh(w, 'evt-c-10', 'PAYMENT_CONFIRMED', 'sub_000000000C01', 'cus_000000000C01', 'pay_000000000C02B', 49.90, '2026-10-10');
  perform pg_temp._ck('S2 segunda COBRANCA confirmada no mesmo ciclo nao soma meses (usa o maior vencimento)',
    h1 = 'applied' and (select current_period_end = timestamptz '2026-11-10 00:00:00-03' from public.billing_subscriptions where provider_subscription_id = 'sub_000000000C01'));

  -- ============================================================
  -- S3 — atraso, renovação e estorno (continua na loja C)
  -- ============================================================
  h1 := pg_temp._wh(w, 'evt-c-11', 'PAYMENT_CREATED', 'sub_000000000C01', 'cus_000000000C01', 'pay_000000000C03', 49.90, '2026-11-10');
  perform pg_temp._ck('S3 renovacao: cobranca do proximo mes criada (pending), assinatura segue active',
    h1 = 'applied' and (select status = 'active' from public.billing_subscriptions where provider_subscription_id = 'sub_000000000C01')
    and public._restaurant_access_state(sc[2]) is null);
  h1 := pg_temp._wh(w, 'evt-c-12', 'PAYMENT_OVERDUE', 'sub_000000000C01', 'cus_000000000C01', 'pay_000000000C03', 49.90, '2026-11-10');
  perform pg_temp._ck('S3 PAYMENT_OVERDUE da renovacao: assinatura OVERDUE e loja bloqueada (overdue)',
    h1 = 'applied' and (select status = 'overdue' from public.billing_subscriptions where provider_subscription_id = 'sub_000000000C01')
    and (select subscription_status = 'overdue' from public.restaurants where id = sc[2])
    and public._restaurant_access_state(sc[2]) = 'overdue');
  h1 := pg_temp._wh(w, 'evt-c-13', 'PAYMENT_CONFIRMED', 'sub_000000000C01', 'cus_000000000C01', 'pay_000000000C03', 49.90, '2026-11-10');
  perform pg_temp._ck('S3 pagamento ATRASADO e depois confirmado reativa a loja e avanca o periodo (2026-12-10)',
    h1 = 'applied' and (select status = 'active' and current_period_end = timestamptz '2026-12-10 00:00:00-03'
           from public.billing_subscriptions where provider_subscription_id = 'sub_000000000C01')
    and public._restaurant_access_state(sc[2]) is null);
  h1 := pg_temp._wh(w, 'evt-c-14', 'PAYMENT_OVERDUE', 'sub_000000000C01', 'cus_000000000C01', 'pay_000000000C03', 49.90, '2026-11-10');
  perform pg_temp._ck('S3 FORA DE ORDEM: OVERDUE que chega depois da confirmacao e ignorado (stale)',
    h1 = 'stale' and public._restaurant_access_state(sc[2]) is null);
  h1 := pg_temp._wh(w, 'evt-c-15', 'PAYMENT_CREATED', 'sub_000000000C01', 'cus_000000000C01', 'pay_000000000C03', 49.90, '2026-11-10');
  perform pg_temp._ck('S3 FORA DE ORDEM: CREATED atrasado nao rebaixa uma cobranca confirmada',
    h1 = 'stale' and (select status = 'confirmed' from public.billing_payments where provider_payment_id = 'pay_000000000C03'));

  -- loja E: trial em vigor — pending e atraso da 1a cobranca não tiram o teste gratuito
  perform pg_temp._ck('S3 loja com trial em vigor: baseline liberada', public._restaurant_access_state(se[2]) is null);
  r := pg_temp._subscribe(se[1], v_plan, 'cus_000000000E01', 'sub_000000000E01');
  perform pg_temp._ck('S3 trial em vigor + assinatura pending: segue liberada pelo TESTE (cortesia/trial preservados)',
    r = 'OK' and public._restaurant_access_state(se[2]) is null);
  h1 := pg_temp._wh(w, 'evt-e-1', 'PAYMENT_OVERDUE', 'sub_000000000E01', 'cus_000000000E01', 'pay_000000000E01', 49.90, '2026-10-10');
  perform pg_temp._ck('S3 1a cobranca atrasada e NUNCA paga: continua pending (nao derruba o teste gratuito)',
    h1 = 'applied' and (select status = 'pending' from public.billing_subscriptions where provider_subscription_id = 'sub_000000000E01')
    and public._restaurant_access_state(se[2]) is null);
  update public.profiles set trial_ends_at = now() - interval '1 day' where user_id = se[1];
  perform pg_temp._ck('S3 acabado o teste, a assinatura nunca paga NAO mantem acesso',
    public._restaurant_access_state(se[2]) = 'trial_expired');
  h1 := pg_temp._wh(w, 'evt-e-2', 'PAYMENT_RECEIVED', 'sub_000000000E01', 'cus_000000000E01', 'pay_000000000E01', 49.90, '2026-10-10');
  perform pg_temp._ck('S3 pagando a 1a cobranca (atrasada) a loja e liberada',
    h1 = 'applied' and public._restaurant_access_state(se[2]) is null);

  -- estorno: voltar a nao ter pagamento confirmado bloqueia de novo
  h1 := pg_temp._wh(w, 'evt-c-16', 'PAYMENT_REFUNDED', 'sub_000000000C01', 'cus_000000000C01', 'pay_000000000C03', 49.90, '2026-11-10');
  perform pg_temp._ck('S3 estorno de UMA cobranca nao cancela a assinatura',
    h1 = 'applied' and (select status <> 'cancelled' from public.billing_subscriptions where provider_subscription_id = 'sub_000000000C01'));
  h1 := pg_temp._wh(w, 'evt-c-17', 'PAYMENT_REFUNDED', 'sub_000000000C01', 'cus_000000000C01', 'pay_000000000C01', 49.90, '2026-10-10');
  h2 := pg_temp._wh(w, 'evt-c-18', 'PAYMENT_DELETED', 'sub_000000000C01', 'cus_000000000C01', 'pay_000000000C02B', 49.90, '2026-10-10');
  perform pg_temp._ck('S3 estornadas TODAS as cobrancas confirmadas: sem pagamento, sem acesso pago',
    h1 = 'applied' and h2 = 'applied'
    and (select status = 'pending' from public.billing_subscriptions where provider_subscription_id = 'sub_000000000C01')
    and public._restaurant_access_state(sc[2]) = 'trial_expired');
  h1 := pg_temp._wh(w, 'evt-c-19', 'PAYMENT_CONFIRMED', 'sub_000000000C01', 'cus_000000000C01', 'pay_000000000C01', 49.90, '2026-10-10',
                    p_occ => now() + interval '5 minutes');
  perform pg_temp._ck('S3 estorno e terminal: CONFIRMED que chega depois do estorno e ignorado (stale), mesmo com horario novo',
    h1 = 'stale' and public._restaurant_access_state(sc[2]) = 'trial_expired');

  -- ============================================================
  -- S3b — chargeback, prorrogação e restauração (horário do evento decide)
  -- ============================================================
  r := pg_temp._subscribe(si[1], v_plan, 'cus_000000000I01', 'sub_000000000I01');
  h1 := pg_temp._wh(w, 'evt-i-1', 'PAYMENT_CONFIRMED', 'sub_000000000I01', 'cus_000000000I01', 'pay_000000000I01', 49.90, '2026-10-10', p_occ => now());
  perform pg_temp._ck('S3b loja I paga e liberada', r = 'OK' and h1 = 'applied' and public._restaurant_access_state(si[2]) is null);
  h1 := pg_temp._wh(w, 'evt-i-2', 'PAYMENT_CHARGEBACK_REQUESTED', 'sub_000000000I01', 'cus_000000000I01', 'pay_000000000I01', 49.90, '2026-10-10',
                    p_occ => now() + interval '1 minute');
  perform pg_temp._ck('S3b CHARGEBACK_REQUESTED: a cobranca deixa de contar como paga e a loja e bloqueada',
    h1 = 'applied' and (select status = 'chargeback' from public.billing_payments where provider_payment_id = 'pay_000000000I01')
    and (select status = 'pending' from public.billing_subscriptions where provider_subscription_id = 'sub_000000000I01')
    and public._restaurant_access_state(si[2]) = 'trial_expired');
  h1 := pg_temp._wh(w, 'evt-i-3', 'PAYMENT_CONFIRMED', 'sub_000000000I01', 'cus_000000000I01', 'pay_000000000I01', 49.90, '2026-10-10',
                    p_occ => now() + interval '30 seconds');
  h2 := pg_temp._wh(w, 'evt-i-4', 'PAYMENT_CONFIRMED', 'sub_000000000I01', 'cus_000000000I01', 'pay_000000000I01', 49.90, '2026-10-10');
  perform pg_temp._ck('S3b CONFIRMED com horario ANTERIOR ao chargeback, ou sem horario, e ignorado (stale)',
    h1 = 'stale' and h2 = 'stale' and public._restaurant_access_state(si[2]) = 'trial_expired');
  h1 := pg_temp._wh(w, 'evt-i-5', 'PAYMENT_CONFIRMED', 'sub_000000000I01', 'cus_000000000I01', 'pay_000000000I01', 49.90, '2026-10-10',
                    p_occ => now() + interval '2 minutes');
  perform pg_temp._ck('S3b disputa GANHA: CONFIRMED mais novo que o chargeback restaura o pagamento e libera a loja',
    h1 = 'applied' and (select status = 'confirmed' from public.billing_payments where provider_payment_id = 'pay_000000000I01')
    and public._restaurant_access_state(si[2]) is null);
  h1 := pg_temp._wh(w, 'evt-i-6', 'PAYMENT_CHARGEBACK_REQUESTED', 'sub_000000000I01', 'cus_000000000I01', 'pay_000000000I01', 49.90, '2026-10-10',
                    p_occ => now() + interval '3 minutes');
  h2 := pg_temp._wh(w, 'evt-i-7', 'PAYMENT_REFUNDED', 'sub_000000000I01', 'cus_000000000I01', 'pay_000000000I01', 49.90, '2026-10-10',
                    p_occ => now() + interval '4 minutes');
  h3 := pg_temp._wh(w, 'evt-i-8', 'PAYMENT_CONFIRMED', 'sub_000000000I01', 'cus_000000000I01', 'pay_000000000I01', 49.90, '2026-10-10',
                    p_occ => now() + interval '9 minutes');
  perform pg_temp._ck('S3b disputa PERDIDA: chargeback -> estornado e terminal (CONFIRMED posterior nao reabre)',
    h1 = 'applied' and h2 = 'applied' and h3 = 'stale'
    and (select status = 'refunded' from public.billing_payments where provider_payment_id = 'pay_000000000I01')
    and public._restaurant_access_state(si[2]) = 'trial_expired');

  r := pg_temp._subscribe(sj[1], v_plan, 'cus_000000000J01', 'sub_000000000J01');
  h1 := pg_temp._wh(w, 'evt-j-1', 'PAYMENT_CREATED', 'sub_000000000J01', 'cus_000000000J01', 'pay_000000000J01', 49.90, '2026-10-10', p_occ => now());
  h2 := pg_temp._wh(w, 'evt-j-2', 'PAYMENT_OVERDUE', 'sub_000000000J01', 'cus_000000000J01', 'pay_000000000J01', 49.90, '2026-10-10', p_occ => now() + interval '1 minute');
  perform pg_temp._ck('S3b cobranca atrasada (pagamento: overdue)', h1 = 'applied' and h2 = 'applied'
    and (select status = 'overdue' from public.billing_payments where provider_payment_id = 'pay_000000000J01'));
  h1 := pg_temp._wh(w, 'evt-j-3', 'PAYMENT_CREATED', 'sub_000000000J01', 'cus_000000000J01', 'pay_000000000J01', 49.90, '2026-10-10', p_occ => now() + interval '30 seconds');
  h2 := pg_temp._wh(w, 'evt-j-4', 'PAYMENT_CREATED', 'sub_000000000J01', 'cus_000000000J01', 'pay_000000000J01', 49.90, '2026-10-10');
  perform pg_temp._ck('S3b CREATED atrasado (horario anterior) ou sem horario NAO desfaz o atraso',
    h1 = 'stale' and h2 = 'stale' and (select status = 'overdue' from public.billing_payments where provider_payment_id = 'pay_000000000J01'));
  h1 := pg_temp._wh(w, 'evt-j-5', 'PAYMENT_RESTORED', 'sub_000000000J01', 'cus_000000000J01', 'pay_000000000J01', 49.90, '2026-10-10', p_occ => now() + interval '2 minutes');
  perform pg_temp._ck('S3b vencimento prorrogado: evento MAIS NOVO volta a cobranca a pending',
    h1 = 'applied' and (select status = 'pending' from public.billing_payments where provider_payment_id = 'pay_000000000J01'));
  h1 := pg_temp._wh(w, 'evt-j-6', 'PAYMENT_DELETED', 'sub_000000000J01', 'cus_000000000J01', 'pay_000000000J01', 49.90, '2026-10-10', p_occ => now() + interval '3 minutes');
  h2 := pg_temp._wh(w, 'evt-j-7', 'PAYMENT_RESTORED', 'sub_000000000J01', 'cus_000000000J01', 'pay_000000000J01', 49.90, '2026-10-10', p_occ => now() + interval '1 minute');
  h3 := pg_temp._wh(w, 'evt-j-8', 'PAYMENT_RESTORED', 'sub_000000000J01', 'cus_000000000J01', 'pay_000000000J01', 49.90, '2026-10-10', p_occ => now() + interval '4 minutes');
  perform pg_temp._ck('S3b excluida e restaurada: RESTORED antigo e ignorado, RESTORED novo restaura',
    h1 = 'applied' and h2 = 'stale' and h3 = 'applied'
    and (select status = 'pending' from public.billing_payments where provider_payment_id = 'pay_000000000J01'));

  -- ============================================================
  -- S4 — cancelamento e nova assinatura (loja D)
  -- ============================================================
  r := pg_temp._subscribe(sd[1], v_plan, 'cus_000000000D01', 'sub_000000000D01');
  h1 := pg_temp._wh(w, 'evt-d-1', 'PAYMENT_CONFIRMED', 'sub_000000000D01', 'cus_000000000D01', 'pay_000000000D01', 49.90, '2020-01-10');
  perform pg_temp._ck('S4 loja D paga e liberada', r = 'OK' and public._restaurant_access_state(sd[2]) is null);
  perform pg_temp._ck('S4 enquanto ativa: nao da para abrir 2a assinatura (already_subscribed)',
    pg_temp._run(sd[1], format('select out_subscription_id::text from public.billing_begin_subscription(%L)', v_plan)) like '%already_subscribed%');
  h1 := pg_temp._wh(w, 'evt-d-2', 'SUBSCRIPTION_DELETED', 'sub_000000000D01', 'cus_000000000D01', null, null);
  perform pg_temp._ck('S4 SUBSCRIPTION_DELETED cancela: espelho cancelled; periodo pago (2020-01-10 + 1 mes) ja venceu, entao bloqueia',
    h1 = 'cancelled'
    and (select status = 'cancelled' and cancelled_at is not null from public.billing_subscriptions where provider_subscription_id = 'sub_000000000D01')
    and (select subscription_status = 'cancelled' from public.restaurants where id = sd[2])
    and public._restaurant_access_state(sd[2]) = 'cancelled');
  h1 := pg_temp._wh(w, 'evt-d-3', 'SUBSCRIPTION_INACTIVATED', 'sub_000000000D01', 'cus_000000000D01', null, null);
  perform pg_temp._ck('S4 cancelamento repetido (outro evento) e inofensivo', h1 = 'already_cancelled');
  h1 := pg_temp._wh(w, 'evt-d-4', 'PAYMENT_CONFIRMED', 'sub_000000000D01', 'cus_000000000D01', 'pay_000000000D02', 49.90, '2020-02-10');
  perform pg_temp._ck('S4 FORA DE ORDEM: pagamento (de periodo antigo) que chega DEPOIS do cancelamento NAO ressuscita a assinatura',
    h1 = 'applied' and (select status = 'cancelled' from public.billing_subscriptions where provider_subscription_id = 'sub_000000000D01')
    and public._restaurant_access_state(sd[2]) = 'cancelled');
  perform pg_temp._ck('S4 cancelada: OWNER nao se reativa por UPDATE direto',
    pg_temp._run(sd[1], format($q$ update public.restaurants set subscription_status = 'active' where id = %L returning id::text $q$, sd[2])) like '%permission denied%'
    and public._restaurant_access_state(sd[2]) = 'cancelled');
  r := pg_temp._subscribe(sd[1], v_plan, 'cus_000000000D02', 'sub_000000000D02');
  perform pg_temp._ck('S4 apos cancelar, o OWNER pode assinar de novo (nova assinatura, pending)',
    r = 'OK' and (select count(*) from public.billing_subscriptions where restaurant_id = sd[2]) = 2
    and (select subscription_status = 'pending' and asaas_subscription_id = 'sub_000000000D02' from public.restaurants where id = sd[2]));
  perform pg_temp._ck('S4 nova assinatura sem pagamento: loja segue sem acesso (trial_expired)',
    public._restaurant_access_state(sd[2]) = 'trial_expired');
  h1 := pg_temp._wh(w, 'evt-d-5', 'PAYMENT_OVERDUE', 'sub_000000000D01', 'cus_000000000D01', 'pay_000000000D03', 49.90, '2026-12-10');
  perform pg_temp._ck('S4 evento da assinatura ANTIGA cancelada nao afeta a nova',
    h1 = 'applied' and (select status = 'pending' from public.billing_subscriptions where provider_subscription_id = 'sub_000000000D02'));
  h1 := pg_temp._wh(w, 'evt-d-6', 'PAYMENT_CONFIRMED', 'sub_000000000D02', 'cus_000000000D02', 'pay_000000000D04', 49.90, '2026-12-10');
  perform pg_temp._ck('S4 pagamento da nova assinatura libera a loja', h1 = 'applied' and public._restaurant_access_state(sd[2]) is null);

  -- cancelar antes de pagar: volta ao estado "sem assinatura" (trial/cortesia continuam valendo)
  update public.profiles set trial_ends_at = now() + interval '10 days' where user_id = sg[1];
  r := pg_temp._subscribe(sg[1], v_plan, 'cus_000000000G01', 'sub_000000000G01');
  perform pg_temp._ck('S4 loja G (trial em vigor) assina e segue liberada pelo teste', r = 'OK' and public._restaurant_access_state(sg[2]) is null);
  h1 := pg_temp._wh(w, 'evt-g-1', 'SUBSCRIPTION_DELETED', 'sub_000000000G01', 'cus_000000000G01', null, null);
  perform pg_temp._ck('S4 cancelar ANTES de pagar: espelho volta a "sem assinatura" e o teste continua',
    h1 = 'cancelled'
    and (select plan_id is null and subscription_status = 'active' and asaas_subscription_id is null from public.restaurants where id = sg[2])
    and public._restaurant_access_state(sg[2]) is null);
  perform pg_temp._ck('S4 cancelamento de quem nunca pagou NAO conta como churn na metrica (new_status = withdrawn)',
    exists (select 1 from public.asaas_webhook_events where asaas_event_id = 'evt-g-1' and payload ->> 'new_status' = 'withdrawn'));
  perform pg_temp._ck('S4 cancelamento de quem JA pagou conta como churn (new_status = cancelled)',
    exists (select 1 from public.asaas_webhook_events where asaas_event_id = 'evt-d-2' and payload ->> 'new_status' = 'cancelled'));

  -- ============================================================
  -- S5 — evento que chega antes do registro (corrida webhook × registro)
  -- ============================================================
  h1 := pg_temp._wh(w, 'evt-f-1', 'PAYMENT_CONFIRMED', 'sub_000000000F01', 'cus_000000000F01', 'pay_000000000F01', 49.90, '2026-10-10');
  perform pg_temp._ck('S5 CONFIRMED chega ANTES do registro dos ids: fica guardado como unmatched',
    h1 = 'unmatched' and public._restaurant_access_state(sf[2]) = 'trial_expired');
  r := pg_temp._subscribe(sf[1], v_plan, 'cus_000000000F01', 'sub_000000000F01');
  perform pg_temp._ck('S5 ao registrar os ids, o evento guardado e reaplicado: assinatura ACTIVE e loja liberada',
    r = 'OK'
    and (select status = 'active' from public.billing_subscriptions where provider_subscription_id = 'sub_000000000F01')
    and public._restaurant_access_state(sf[2]) is null
    and (select result = 'applied' from public.asaas_webhook_events where asaas_event_id = 'evt-f-1'));
  h1 := pg_temp._wh(w, 'evt-h-1', 'PAYMENT_CONFIRMED', 'sub_000000000H01', 'cus_OUTRO0000002', 'pay_000000000H01', 49.90, '2026-10-10');
  h2 := pg_temp._subscribe(sh[1], v_plan, 'cus_000000000H01', 'sub_000000000H01');
  perform pg_temp._ck('S5 evento guardado de OUTRO cliente nao e aplicado ao registrar (customer_mismatch)',
    h1 = 'unmatched' and h2 = 'OK'
    and (select status = 'pending' from public.billing_subscriptions where provider_subscription_id = 'sub_000000000H01')
    and public._restaurant_access_state(sh[2]) = 'trial_expired'
    and (select result = 'customer_mismatch' from public.asaas_webhook_events where asaas_event_id = 'evt-h-1'));

  -- ============================================================
  -- S6 — manipulação por OWNER/STAFF e isolamento entre restaurantes
  -- ============================================================
  perform pg_temp._ck('S6 STAFF nao abre assinatura (exige OWNER)',
    pg_temp._run(u_staff, format('select out_subscription_id::text from public.billing_begin_subscription(%L)', v_plan)) like '%not_authorized%');
  perform pg_temp._ck('S6 usuario sem loja nao abre assinatura',
    pg_temp._run(u_stranger, format('select out_subscription_id::text from public.billing_begin_subscription(%L)', v_plan)) like '%not_authorized%');
  perform pg_temp._ck('S6 master (sem ser membro) nao abre assinatura de outra loja',
    pg_temp._run(u_master, format('select out_subscription_id::text from public.billing_begin_subscription(%L)', v_plan)) like '%not_authorized%');
  perform pg_temp._ck('S6 anon nao abre assinatura',
    pg_temp._run(null, format('select out_subscription_id::text from public.billing_begin_subscription(%L)', v_plan)) like '%permission denied%');

  perform pg_temp._ck('S6 plano inativo e recusado (plan_not_found)',
    pg_temp._run(sb[1], format('select out_subscription_id::text from public.billing_begin_subscription(%L)', v_plan_off)) like '%plan_not_found%');
  perform pg_temp._ck('S6 plano inexistente e recusado',
    pg_temp._run(sb[1], format('select out_subscription_id::text from public.billing_begin_subscription(%L)', gen_random_uuid())) like '%plan_not_found%');
  perform pg_temp._ck('S6 plano gratuito (preco 0) nao e cobravel',
    pg_temp._run(sb[1], format('select out_subscription_id::text from public.billing_begin_subscription(%L)', v_plan_free)) like '%plan_not_billable%');
  perform pg_temp._ck('S6 provedor nao habilitado e recusado',
    pg_temp._run(sb[1], format('select out_subscription_id::text from public.billing_begin_subscription(%L, %L)', v_plan, 'stripe')) like '%invalid_provider%');
  perform pg_temp._ck('S6 as tentativas recusadas nao deixaram assinatura na loja B',
    not exists (select 1 from public.billing_subscriptions where restaurant_id = sb[2]));

  -- loja B abre uma tentativa; ninguem (OWNER, STAFF, master, anon, outra loja) registra ids nela
  r := pg_temp._run(sb[1], format('select out_subscription_id::text from public.billing_begin_subscription(%L)', v_plan));
  perform pg_temp._ck('S6 NINGUEM alem do backend registra ids: OWNER dono da tentativa, OWNER de outra loja, STAFF, master e anon',
    pg_temp._run(sb[1], format('select public.billing_attach_provider_subscription(%L, %L, %L, 49.90)::text', r, 'cus_000000000X01', 'sub_000000000X01')) like '%permission denied%'
    and pg_temp._run(sd[1], format('select public.billing_attach_provider_subscription(%L, %L, %L, 49.90)::text', r, 'cus_000000000X01', 'sub_000000000X01')) like '%permission denied%'
    and pg_temp._run(u_staff, format('select public.billing_attach_provider_subscription(%L, %L, %L, 49.90)::text', r, 'cus_000000000X01', 'sub_000000000X01')) like '%permission denied%'
    and pg_temp._run(u_master, format('select public.billing_attach_provider_subscription(%L, %L, %L, 49.90)::text', r, 'cus_000000000X01', 'sub_000000000X01')) like '%permission denied%'
    and pg_temp._run(null, format('select public.billing_attach_provider_subscription(%L, %L, %L, 49.90)::text', r, 'cus_000000000X01', 'sub_000000000X01')) like '%permission denied%');
  perform pg_temp._ck('S6 backend nao registra o id de assinatura que JA pertence a loja C (provider_reference_in_use)',
    pg_temp._svc(format('select public.billing_attach_provider_subscription(%L, %L, %L, 49.90)::text', r, 'cus_000000000C01', 'sub_000000000C01')) like '%provider_reference_in_use%');
  perform pg_temp._ck('S6 ...e a assinatura de B continua "initiated", sem ids',
    (select status = 'initiated' and provider_subscription_id is null from public.billing_subscriptions where id = r::uuid));
  perform pg_temp._ck('S6 registrar id de tentativa inexistente da subscription_not_found',
    pg_temp._svc(format('select public.billing_attach_provider_subscription(%L, %L, %L, 49.90)::text', gen_random_uuid(), 'cus_000000000X01', 'sub_000000000X01')) like '%subscription_not_found%');
  perform pg_temp._ck('S6 registrar ids numa assinatura que NAO esta "initiated" e recusado (invalid_state)',
    pg_temp._svc(format('select public.billing_attach_provider_subscription(%L, %L, %L, 49.90)::text',
      (select id from public.billing_subscriptions where provider_subscription_id = 'sub_000000000H01'), 'cus_000000000Y01', 'sub_000000000Y01')) like '%invalid_state%');

  perform pg_temp._ck('S6 OWNER nao chama o webhook nem com o token correto (so o provedor, como anon)',
    pg_temp._run(sb[1], format('select public.process_asaas_webhook(%L, %L, %L, null, %L, %L, %L, 49.90, null, null, null)',
      w, 'evt-hack-1', 'PAYMENT_CONFIRMED', 'sub_000000000C01', 'cus_000000000C01', 'pay_hack000001')) like '%permission denied%');
  perform pg_temp._ck('S6 STAFF tambem nao chama o webhook',
    pg_temp._run(u_staff, format('select public.process_asaas_webhook(%L, %L, %L, null, %L, %L, %L, 49.90, null, null, null)',
      w, 'evt-hack-2', 'PAYMENT_CONFIRMED', 'sub_000000000C01', 'cus_000000000C01', 'pay_hack000002')) like '%permission denied%');
  perform pg_temp._ck('S6 funcoes internas _billing_* nao sao chamaveis pela API',
    pg_temp._run(sb[1], format('select public._billing_recompute(%L)::text', r)) like '%permission denied%'
    and pg_temp._run(null, format('select public._billing_recompute(%L)::text', r)) like '%permission denied%'
    and pg_temp._run(sb[1], format('select public._restaurant_access_state(%L)', sb[2])) like '%permission denied%');
  perform pg_temp._ck('S6 reconciliacao e listagem so para o backend (OWNER e anon recusados)',
    pg_temp._run(sb[1], 'select count(*)::text from public.billing_list_reconcilable(10)') like '%permission denied%'
    and pg_temp._run(null, 'select count(*)::text from public.billing_list_reconcilable(10)') like '%permission denied%'
    and pg_temp._run(sc[1], format('select public.billing_reconcile_payment(%L, %L, %L, %L, %L, false, 49.90, null, null, null)', 'asaas', 'sub_000000000C01', 'cus_000000000C01', 'pay_000000000C01', 'CONFIRMED')) like '%permission denied%'
    and pg_temp._run(sc[1], format('select public.billing_reconcile_subscription(%L, %L, %L, %L, false)', 'asaas', 'sub_000000000C01', 'cus_000000000C01', 'INACTIVE')) like '%permission denied%');

  h1 := pg_temp._wh(w, 'evt-iso-1', 'PAYMENT_CONFIRMED', 'sub_000000000C01', 'cus_000000000C01', 'pay_000000000C09', 49.90, '2026-10-10');
  perform pg_temp._ck('S6 ISOLAMENTO: evento da assinatura da loja C nao altera a loja B',
    h1 in ('applied', 'stale', 'noop')
    and public._restaurant_access_state(sb[2]) = 'trial_expired'
    and (select plan_id is null from public.restaurants where id = sb[2]));
  perform pg_temp._ck('S6 ISOLAMENTO: pagamento confirmado na loja D nao libera a loja B',
    public._restaurant_access_state(sd[2]) is null and public._restaurant_access_state(sb[2]) = 'trial_expired');
  perform pg_temp._ck('S6 ISOLAMENTO: OWNER da loja B nao enxerga eventos de webhook (RLS sem policy: 0 linhas)',
    pg_temp._run(sb[1], 'select count(*)::text from public.asaas_webhook_events') in ('0')
    or pg_temp._run(sb[1], 'select count(*)::text from public.asaas_webhook_events') like '%permission denied%');
  perform pg_temp._ck('S6 ISOLAMENTO: cada cobranca pertence a UMA assinatura (evento com pagamento de outra e rejeitado)',
    pg_temp._wh(w, 'evt-iso-2', 'PAYMENT_CONFIRMED', 'sub_000000000D02', 'cus_000000000D02', 'pay_000000000D01', 49.90, '2026-10-10') = 'payment_mismatch');

  -- ============================================================
  -- S7 — webhook inválido
  -- ============================================================
  n := (select count(*) from public.asaas_webhook_events);
  perform pg_temp._ck('S7 token nulo e recusado',
    pg_temp._run(null, 'select public.process_asaas_webhook(null, ''e1'', ''PAYMENT_CONFIRMED'', null, ''sub_000000000C01'', ''cus_000000000C01'', ''pay_n'', 49.90, null, null, null)') like '%not_authorized%');
  perform pg_temp._ck('S7 token vazio e recusado',
    pg_temp._wh('', 'e2', 'PAYMENT_CONFIRMED', 'sub_000000000C01', 'cus_000000000C01', 'pay_n', 49.90) like '%not_authorized%');
  h1 := pg_temp._wh(w || 'x', 'e3', 'PAYMENT_CONFIRMED', 'sub_000000000C01', 'cus_000000000C01', 'pay_n', 49.90);
  h2 := pg_temp._wh(substr(w, 2), 'e4', 'PAYMENT_CONFIRMED', 'sub_000000000C01', 'cus_000000000C01', 'pay_n', 49.90);
  perform pg_temp._ck('S7 token com um caractere a mais/menos e recusado', h1 like '%not_authorized%' and h2 like '%not_authorized%');
  perform pg_temp._ck('S7 token com caixa diferente e recusado (comparacao exata)',
    pg_temp._wh(upper(w), 'e5', 'PAYMENT_CONFIRMED', 'sub_000000000C01', 'cus_000000000C01', 'pay_n', 49.90) like '%not_authorized%');
  perform pg_temp._ck('S7 token gigante (> 512) e recusado sem erro de processamento',
    pg_temp._wh(repeat('w', 600), 'e5b', 'PAYMENT_CONFIRMED', 'sub_000000000C01', 'cus_000000000C01', 'pay_n', 49.90) like '%not_authorized%');
  perform pg_temp._ck('S7 nenhuma tentativa com token invalido gravou evento', (select count(*) from public.asaas_webhook_events) = n);
  perform pg_temp._ck('S7 verificador de token: certo=true, errado/nulo/vazio=false (anon pode chamar; nao revela o token)',
    pg_temp._run(null, format('select public.billing_webhook_token_valid(%L)::text', w)) = 'true'
    and pg_temp._run(null, 'select public.billing_webhook_token_valid(''errado'')::text') = 'false'
    and pg_temp._run(null, 'select public.billing_webhook_token_valid(null)::text') = 'false'
    and pg_temp._run(null, 'select public.billing_webhook_token_valid('''')::text') = 'false'
    and pg_temp._run(sb[1], format('select public.billing_webhook_token_valid(%L)::text', w)) like '%permission denied%');

  perform pg_temp._ck('S7 id de evento vazio e rejeitado (invalid_event)',
    pg_temp._wh(w, '', 'PAYMENT_CONFIRMED', 'sub_000000000C01', 'cus_000000000C01', 'pay_n', 49.90) like '%invalid_event%');
  perform pg_temp._ck('S7 id de evento gigante e rejeitado',
    pg_temp._wh(w, repeat('e', 500), 'PAYMENT_CONFIRMED', 'sub_000000000C01', 'cus_000000000C01', 'pay_n', 49.90) like '%invalid_event%');
  h1 := pg_temp._wh(w, 'e6', '', 'sub_000000000C01', 'cus_000000000C01', 'pay_n', 49.90);
  h2 := pg_temp._wh(w, 'e7', repeat('T', 300), 'sub_000000000C01', 'cus_000000000C01', 'pay_n', 49.90);
  perform pg_temp._ck('S7 tipo de evento vazio ou gigante e rejeitado', h1 like '%invalid_event%' and h2 like '%invalid_event%');
  perform pg_temp._ck('S7 evento desconhecido (BANK_SLIP_VIEWED) e ignorado, sem efeito',
    pg_temp._wh(w, 'e8', 'PAYMENT_BANK_SLIP_VIEWED', 'sub_000000000D02', 'cus_000000000D02', 'pay_000000000D04', 49.90) = 'ignored');
  h1 := pg_temp._wh(w, 'e9', 'PAYMENT_UPDATED', 'sub_000000000D02', 'cus_000000000D02', 'pay_000000000D04', 1.00);
  h2 := pg_temp._wh(w, 'e10', 'PAYMENT_SPLIT_DONE', 'sub_000000000D02', 'cus_000000000D02', 'pay_000000000D04', 1.00);
  h3 := pg_temp._wh(w, 'e10b', 'PAYMENT_PARTIALLY_REFUNDED', 'sub_000000000D02', 'cus_000000000D02', 'pay_000000000D04', 1.00);
  perform pg_temp._ck('S7 PAYMENT_UPDATED, split e estorno parcial sao ignorados', h1 = 'ignored' and h2 = 'ignored' and h3 = 'ignored');
  perform pg_temp._ck('S7 evento sem assinatura (cobranca avulsa) e ignorado',
    pg_temp._wh(w, 'e11', 'PAYMENT_CONFIRMED', null, 'cus_000000000D02', 'pay_avulsa001', 49.90) = 'ignored');
  h1 := pg_temp._wh(w, 'e12''; drop table public.restaurants;--', 'PAYMENT_CONFIRMED', 'sub_x''); delete from public.plans;--', 'cus_x', 'pay_x', 49.90);
  perform pg_temp._ck('S7 injecao de SQL nos campos vira texto inofensivo (unmatched)',
    h1 = 'unmatched' and exists (select 1 from public.restaurants where id = sb[2]) and exists (select 1 from public.plans where id = v_plan));
  perform pg_temp._ck('S7 nenhum evento invalido ou ignorado alterou o status das lojas',
    public._restaurant_access_state(sd[2]) is null and public._restaurant_access_state(sb[2]) = 'trial_expired');

  update public.billing_settings set asaas_webhook_token = null where id = true;
  h1 := pg_temp._wh(w, 'e13', 'PAYMENT_CONFIRMED', 'sub_000000000H01', 'cus_000000000H01', 'pay_000000000H01', 49.90);
  h2 := pg_temp._wh('', 'e14', 'PAYMENT_CONFIRMED', 'sub_000000000H01', 'cus_000000000H01', 'pay_000000000H01', 49.90);
  perform pg_temp._ck('S7 webhook desligado (sem token cadastrado): fail-closed mesmo com "o token certo"',
    h1 like '%not_authorized%' and h2 like '%not_authorized%'
    and pg_temp._run(null, format('select public.billing_webhook_token_valid(%L)::text', w)) = 'false'
    and public._restaurant_access_state(sh[2]) = 'trial_expired');
  update public.billing_settings set asaas_webhook_token = w where id = true;

  -- ============================================================
  -- S10 — período pago após cancelamento e bloqueio administrativo
  -- ============================================================
  r := pg_temp._subscribe(sk[1], v_plan, 'cus_000000000K01', 'sub_000000000K01');
  h1 := pg_temp._wh(w, 'evt-k-1', 'PAYMENT_CONFIRMED', 'sub_000000000K01', 'cus_000000000K01', 'pay_000000000K01', 49.90, current_date);
  h2 := pg_temp._wh(w, 'evt-k-2', 'SUBSCRIPTION_DELETED', 'sub_000000000K01', 'cus_000000000K01', null, null);
  perform pg_temp._ck('S10 cancelada DENTRO do periodo pago: mantem o acesso ate o fim do periodo',
    r = 'OK' and h1 = 'applied' and h2 = 'cancelled'
    and (select status = 'cancelled' and current_period_end > now() from public.billing_subscriptions where provider_subscription_id = 'sub_000000000K01')
    and (select subscription_status = 'cancelled' from public.restaurants where id = sk[2])
    and public._restaurant_access_state(sk[2]) is null);
  update public.billing_subscriptions set current_period_end = now() - interval '1 second' where provider_subscription_id = 'sub_000000000K01';
  perform pg_temp._ck('S10 ...e bloqueia assim que o periodo pago acaba (sem job: calculado na leitura)',
    public._restaurant_access_state(sk[2]) = 'cancelled');
  update public.billing_subscriptions set current_period_end = now() + interval '1 second' where provider_subscription_id = 'sub_000000000K01';
  perform pg_temp._ck('S10 ...fronteira: ainda vigente 1 segundo antes do fim', public._restaurant_access_state(sk[2]) is null);

  r := pg_temp._subscribe(sl[1], v_plan, 'cus_000000000L01', 'sub_000000000L01');
  h1 := pg_temp._wh(w, 'evt-l-1', 'PAYMENT_CONFIRMED', 'sub_000000000L01', 'cus_000000000L01', 'pay_000000000L01', 49.90, current_date);
  h2 := pg_temp._wh(w, 'evt-l-2', 'SUBSCRIPTION_DELETED', 'sub_000000000L01', 'cus_000000000L01', null, null);
  perform pg_temp._ck('S10 loja L: cancelada com periodo pago, acesso preservado', public._restaurant_access_state(sl[2]) is null);
  h1 := pg_temp._wh(w, 'evt-l-3', 'PAYMENT_REFUNDED', 'sub_000000000L01', 'cus_000000000L01', 'pay_000000000L01', 49.90, current_date);
  perform pg_temp._ck('S10 ESTORNO depois do cancelamento remove o periodo pago e bloqueia na hora',
    h1 = 'applied' and (select current_period_end is null from public.billing_subscriptions where provider_subscription_id = 'sub_000000000L01')
    and public._restaurant_access_state(sl[2]) = 'cancelled');

  r := pg_temp._subscribe(sm[1], v_plan, 'cus_000000000M01', 'sub_000000000M01');
  h1 := pg_temp._wh(w, 'evt-m-1', 'PAYMENT_CONFIRMED', 'sub_000000000M01', 'cus_000000000M01', 'pay_000000000M01', 49.90, current_date);
  perform pg_temp._ck('S10 loja M ativa e paga', h1 = 'applied' and public._restaurant_access_state(sm[2]) is null);
  perform pg_temp._ck('S10 OWNER, STAFF e anon NAO bloqueiam nem desbloqueiam (so o Master)',
    pg_temp._run(sm[1], format('select public.master_set_billing_block(%L, true, %L)::text', sm[2], 'x')) like '%not_authorized%'
    and pg_temp._run(u_staff, format('select public.master_set_billing_block(%L, true, %L)::text', sm[2], 'x')) like '%not_authorized%'
    and pg_temp._run(null, format('select public.master_set_billing_block(%L, true, %L)::text', sm[2], 'x')) like '%permission denied%'
    and public._restaurant_access_state(sm[2]) is null);
  perform pg_temp._ck('S10 bloqueio exige motivo (1 a 300 caracteres)',
    pg_temp._run(u_master, format('select public.master_set_billing_block(%L, true, null)::text', sm[2])) like '%reason_required%'
    and pg_temp._run(u_master, format('select public.master_set_billing_block(%L, true, %L)::text', sm[2], '   ')) like '%reason_required%'
    and pg_temp._run(u_master, format('select public.master_set_billing_block(%L, true, %L)::text', sm[2], repeat('x', 301))) like '%reason_required%');
  perform pg_temp._ck('S10 loja sem assinatura nao tem o que bloquear (no_subscription)',
    pg_temp._run(u_master, format('select public.master_set_billing_block(%L, true, %L)::text', sb[2], 'teste')) like '%no_subscription%');
  r := pg_temp._run(u_master, format('select public.master_set_billing_block(%L, true, %L)::text', sm[2], 'fraude confirmada'));
  perform pg_temp._ck('S10 BLOQUEIO ADMINISTRATIVO corta o acesso na hora, mesmo pago e ativo',
    r not like 'ERR:%' and public._restaurant_access_state(sm[2]) = 'blocked'
    and (select admin_blocked_at is not null and admin_block_reason = 'fraude confirmada' and admin_blocked_by = u_master
         from public.billing_subscriptions where provider_subscription_id = 'sub_000000000M01'));
  perform pg_temp._ck('S10 ...visivel ao Master (access_state = blocked) e a loja publica fica bloqueada',
    pg_temp._run(u_master, format('select access_state from public.master_get_restaurant(%L)', sm[2])) = 'blocked');
  update public.restaurants set onboarding_completed = true where id = sm[2];
  perform pg_temp._ck('S10 ...e a loja publica informa subscription_blocked',
    pg_temp._run(null, format('select subscription_blocked::text from public.get_public_restaurant_by_slug(%L)', 'sub-billing-13')) = 'true');
  h1 := pg_temp._wh(w, 'evt-m-2', 'PAYMENT_CONFIRMED', 'sub_000000000M01', 'cus_000000000M01', 'pay_000000000M02', 49.90, current_date);
  perform pg_temp._ck('S10 pagamento novo NAO desfaz o bloqueio administrativo', h1 = 'applied' and public._restaurant_access_state(sm[2]) = 'blocked');
  r := pg_temp._run(u_master, format('select public.master_set_billing_block(%L, false)::text', sm[2]));
  perform pg_temp._ck('S10 desbloqueio pelo Master restaura o acesso pago',
    r not like 'ERR:%' and public._restaurant_access_state(sm[2]) is null
    and (select admin_blocked_at is null and admin_block_reason is null from public.billing_subscriptions where provider_subscription_id = 'sub_000000000M01'));

  -- ============================================================
  -- S11 — reconciliação com a API do provedor (backend)
  -- ============================================================
  r := pg_temp._subscribe(sn[1], v_plan, 'cus_000000000N01', 'sub_000000000N01');
  perform pg_temp._ck('S11 webhook PERDIDO: assinatura pending, loja bloqueada', r = 'OK' and public._restaurant_access_state(sn[2]) = 'trial_expired');
  h1 := pg_temp._rec('sub_000000000N01', 'cus_000000000N01', 'pay_000000000N01', 'CONFIRMED', 49.90, current_date);
  perform pg_temp._ck('S11 reconciliacao encontra a cobranca CONFIRMADA na API e libera a loja',
    h1 = 'applied' and (select status = 'active' from public.billing_subscriptions where provider_subscription_id = 'sub_000000000N01')
    and public._restaurant_access_state(sn[2]) is null);
  perform pg_temp._ck('S11 reconciliar de novo e idempotente (noop)',
    pg_temp._rec('sub_000000000N01', 'cus_000000000N01', 'pay_000000000N01', 'RECEIVED', 49.90, current_date) = 'noop');
  perform pg_temp._ck('S11 reconciliacao respeita as mesmas verificacoes: cliente diferente, valor menor e assinatura desconhecida',
    pg_temp._rec('sub_000000000N01', 'cus_OUTRO0000003', 'pay_000000000N02', 'CONFIRMED', 49.90, current_date) = 'customer_mismatch'
    and pg_temp._rec('sub_000000000N01', 'cus_000000000N01', 'pay_000000000N02', 'CONFIRMED', 1.00, current_date) = 'value_mismatch'
    and pg_temp._rec('sub_DESCONHECIDA2', 'cus_000000000N01', 'pay_000000000N02', 'CONFIRMED', 49.90, current_date) = 'unmatched');
  perform pg_temp._ck('S11 status sem efeito (estorno solicitado) e ignorado',
    pg_temp._rec('sub_000000000N01', 'cus_000000000N01', 'pay_000000000N01', 'REFUND_REQUESTED', 49.90) = 'ignored'
    and public._restaurant_access_state(sn[2]) is null);

  r := pg_temp._subscribe(so[1], v_plan, 'cus_000000000O01', 'sub_000000000O01');
  h1 := pg_temp._wh(w, 'evt-o-1', 'PAYMENT_CONFIRMED', 'sub_000000000O01', 'cus_000000000O01', 'pay_000000000O01', 49.90, current_date);
  perform pg_temp._ck('S11 confirmacao FORJADA (com token vazado) libera a loja ate a proxima reconciliacao',
    h1 = 'applied' and public._restaurant_access_state(so[2]) is null);
  h1 := pg_temp._rec('sub_000000000O01', 'cus_000000000O01', 'pay_000000000O01', 'PENDING', 49.90, current_date);
  perform pg_temp._ck('S11 a API diz PENDING: a reconciliacao e autoritativa, corrige e bloqueia de novo',
    h1 = 'applied' and (select status = 'pending' from public.billing_payments where provider_payment_id = 'pay_000000000O01')
    and public._restaurant_access_state(so[2]) = 'trial_expired');
  h1 := pg_temp._rec('sub_000000000O01', 'cus_000000000O01', 'pay_000000000O01', 'OVERDUE', 49.90, current_date);
  h2 := pg_temp._rec('sub_000000000O01', 'cus_000000000O01', 'pay_000000000O01', 'CHARGEBACK_REQUESTED', 49.90, current_date);
  h3 := pg_temp._rec('sub_000000000O01', 'cus_000000000O01', 'pay_000000000O01', 'CONFIRMED', 49.90, current_date);
  perform pg_temp._ck('S11 reconciliacao acompanha qualquer mudanca real da API (overdue, chargeback, confirmed)',
    h1 = 'applied' and h2 = 'applied' and h3 = 'applied' and public._restaurant_access_state(so[2]) is null);
  h1 := pg_temp._rec('sub_000000000O01', 'cus_000000000O01', 'pay_000000000O01', 'CONFIRMED', 49.90, current_date, true);
  perform pg_temp._ck('S11 cobranca excluida na API (deleted = true) deixa de contar',
    h1 = 'applied' and (select status = 'deleted' from public.billing_payments where provider_payment_id = 'pay_000000000O01')
    and public._restaurant_access_state(so[2]) = 'trial_expired');
  perform pg_temp._ck('S11 provedor invalido na reconciliacao e recusado',
    pg_temp._svc(format('select public.billing_reconcile_payment(%L, %L, %L, %L, %L, false, 49.90, null, null, null)', 'stripe', 'sub_x', 'cus_x', 'pay_x', 'CONFIRMED')) like '%invalid_provider%'
    and pg_temp._svc(format('select public.billing_reconcile_subscription(%L, %L, %L, %L, false)', 'stripe', 'sub_x', 'cus_x', 'INACTIVE')) like '%invalid_provider%');

  h1 := pg_temp._svc(format('select public.billing_reconcile_subscription(%L, %L, %L, %L, false)', 'asaas', 'sub_000000000N01', 'cus_000000000N01', 'ACTIVE'));
  perform pg_temp._ck('S11 assinatura ainda ACTIVE na API: nada muda, mas marca a data da conferencia',
    h1 = 'active_remote'
    and (select last_reconciled_at is not null from public.billing_subscriptions where provider_subscription_id = 'sub_000000000N01')
    and (select status = 'active' from public.billing_subscriptions where provider_subscription_id = 'sub_000000000N01'));
  h1 := pg_temp._svc(format('select public.billing_reconcile_subscription(%L, %L, %L, %L, false)', 'asaas', 'sub_000000000N01', 'cus_000000000N01', 'INACTIVE'));
  perform pg_temp._ck('S11 assinatura INACTIVE na API: cancela (cancelamento nao entregue por webhook), preservando o periodo pago',
    h1 = 'cancelled' and (select status = 'cancelled' from public.billing_subscriptions where provider_subscription_id = 'sub_000000000N01')
    and public._restaurant_access_state(sn[2]) is null);
  h1 := pg_temp._svc(format('select public.billing_reconcile_subscription(%L, %L, %L, %L, true)', 'asaas', 'sub_000000000O01', 'cus_000000000O01', 'ACTIVE'));
  perform pg_temp._ck('S11 assinatura removida na API (deleted = true) tambem cancela',
    h1 = 'cancelled' and (select status = 'cancelled' from public.billing_subscriptions where provider_subscription_id = 'sub_000000000O01'));
  perform pg_temp._ck('S11 reconciliar assinatura de outro cliente do provedor e recusado (customer_mismatch)',
    pg_temp._svc(format('select public.billing_reconcile_subscription(%L, %L, %L, %L, false)', 'asaas', 'sub_000000000H01', 'cus_OUTRO0000004', 'INACTIVE')) = 'customer_mismatch');

  -- lista de reconciliacao: assinaturas vivas, as nunca conferidas primeiro
  r := pg_temp._subscribe(sq[1], v_plan, 'cus_000000000Q01', 'sub_000000000Q01');
  perform pg_temp._ck('S11 lista de reconciliacao traz assinaturas pending/active/overdue, nunca conferidas primeiro',
    (select count(*) from public.billing_subscriptions where status in ('pending', 'active', 'overdue')) > 0
    and pg_temp._svc('select out_status from public.billing_list_reconcilable(1)') in ('pending', 'active', 'overdue')
    and (select b.last_reconciled_at is null from public.billing_subscriptions b
         where b.provider_subscription_id = pg_temp._svc('select out_subscription_ref from public.billing_list_reconcilable(1)')));
  update public.billing_subscriptions set cancelled_at = now() - interval '61 days' where provider_subscription_id = 'sub_000000000N01';
  perform pg_temp._ck('S11 cancelada ha mais de 60 dias sai da lista; limite maximo respeitado',
    not exists (select 1 from public.billing_list_reconcilable(200) l where l.out_subscription_ref = 'sub_000000000N01')
    and (select count(*) from public.billing_list_reconcilable(100000)) <= 200);

  -- ============================================================
  -- S12 — o checkout dos clientes não é afetado
  -- ============================================================
  insert into public.categories (restaurant_id, name, display_order) values (sp[2], 'cat-checkout', 1) returning id into v_cat;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (sp[2], 'prod-checkout', 10, v_cat, 1) returning id into v_prod;
  update public.restaurants set onboarding_completed = true, status = 'active', service_pickup = true where id = sp[2];
  delete from public.business_hours where restaurant_id = sp[2];
  insert into public.business_hours (restaurant_id, day_of_week, opens_at, closes_at)
    select sp[2], d, '00:00', '23:59:59' from generate_series(0, 6) d;
  v_slug := 'sub-billing-16';

  perform pg_temp._ck('S12 loja sem nenhum registro de cobranca, com teste valido: o pedido anonimo e aceito (comportamento anterior)',
    pg_temp._order(v_slug, v_prod, 'bill-ord-1') = '1');
  r := pg_temp._subscribe(sp[1], v_plan, 'cus_000000000P01', 'sub_000000000P01');
  perform pg_temp._ck('S12 assinatura pending + teste valido: pedido aceito', r = 'OK' and pg_temp._order(v_slug, v_prod, 'bill-ord-2') = '1');
  update public.profiles set trial_ends_at = now() - interval '1 day' where user_id = sp[1];
  perform pg_temp._ck('S12 teste vencido + assinatura nunca paga: pedido RECUSADO (como antes, loja bloqueada)',
    pg_temp._order(v_slug, v_prod, 'bill-ord-3') like 'ERR:%'
    and (select count(*) from public.orders where restaurant_id = sp[2]) = 2);
  h1 := pg_temp._wh(w, 'evt-p-1', 'PAYMENT_CONFIRMED', 'sub_000000000P01', 'cus_000000000P01', 'pay_000000000P01', 49.90, current_date);
  perform pg_temp._ck('S12 pagamento confirmado: pedido aceito mesmo com o teste vencido',
    h1 = 'applied' and pg_temp._order(v_slug, v_prod, 'bill-ord-4') = '1');
  h1 := pg_temp._wh(w, 'evt-p-2', 'PAYMENT_OVERDUE', 'sub_000000000P01', 'cus_000000000P01', 'pay_000000000P02', 49.90, current_date);
  perform pg_temp._ck('S12 pagamento atrasado: pedido recusado', h1 = 'applied' and pg_temp._order(v_slug, v_prod, 'bill-ord-5') like 'ERR:%');
  h1 := pg_temp._wh(w, 'evt-p-3', 'PAYMENT_CONFIRMED', 'sub_000000000P01', 'cus_000000000P01', 'pay_000000000P02', 49.90, current_date);
  h2 := pg_temp._wh(w, 'evt-p-4', 'SUBSCRIPTION_DELETED', 'sub_000000000P01', 'cus_000000000P01', null, null);
  perform pg_temp._ck('S12 cancelada dentro do periodo pago: pedido aceito', h2 = 'cancelled' and pg_temp._order(v_slug, v_prod, 'bill-ord-6') = '1');
  update public.billing_subscriptions set current_period_end = now() - interval '1 day' where provider_subscription_id = 'sub_000000000P01';
  perform pg_temp._ck('S12 cancelada com periodo vencido: pedido recusado', pg_temp._order(v_slug, v_prod, 'bill-ord-7') like 'ERR:%');
  update public.billing_subscriptions set current_period_end = now() + interval '5 days' where provider_subscription_id = 'sub_000000000P01';
  perform pg_temp._ck('S12 a loja publica informa subscription_blocked coerente (liberada)',
    pg_temp._run(null, format('select subscription_blocked::text from public.get_public_restaurant_by_slug(%L)', v_slug)) = 'false');
  perform pg_temp._run(u_master, format('select public.master_set_billing_block(%L, true, %L)::text', sp[2], 'teste'));
  perform pg_temp._ck('S12 bloqueio administrativo: pedido recusado e a loja publica fica bloqueada',
    pg_temp._order(v_slug, v_prod, 'bill-ord-8') like 'ERR:%'
    and pg_temp._run(null, format('select subscription_blocked::text from public.get_public_restaurant_by_slug(%L)', v_slug)) = 'true');
  perform pg_temp._ck('S12 so os pedidos aceitos foram gravados (4 de 8 tentativas) e o anon nao le a tabela de pedidos',
    (select count(*) from public.orders where restaurant_id = sp[2]) = 4
    and pg_temp._run(null, format('select count(*)::text from public.orders where restaurant_id = %L', sp[2])) in ('0'));
  perform pg_temp._ck('S12 a RPC publica da loja e as tabelas de cobranca continuam isoladas do checkout (anon sem privilegio)',
    not has_table_privilege('anon', 'public.billing_subscriptions', 'SELECT')
    and not has_table_privilege('anon', 'public.billing_payments', 'SELECT')
    and has_function_privilege('anon', 'public.create_order(text,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,text,numeric,text,numeric,text)', 'EXECUTE'));

  -- ============================================================
  -- S8 — catálogo e restrições do banco; cortesia e métrica
  -- ============================================================
  perform pg_temp._ck('S8 authenticated/anon sem nenhum privilegio nas tabelas de cobranca',
    not (has_table_privilege('authenticated', 'public.billing_subscriptions', 'SELECT')
      or has_table_privilege('authenticated', 'public.billing_subscriptions', 'INSERT')
      or has_table_privilege('authenticated', 'public.billing_subscriptions', 'UPDATE')
      or has_table_privilege('authenticated', 'public.billing_subscriptions', 'DELETE')
      or has_table_privilege('anon', 'public.billing_subscriptions', 'SELECT')
      or has_table_privilege('authenticated', 'public.billing_payments', 'SELECT')
      or has_table_privilege('authenticated', 'public.billing_payments', 'INSERT')
      or has_table_privilege('authenticated', 'public.billing_payments', 'UPDATE')
      or has_table_privilege('anon', 'public.billing_payments', 'SELECT')));
  perform pg_temp._ck('S8 RLS ligada nas duas tabelas e no livro de eventos',
    (select bool_and(relrowsecurity) from pg_class where oid in
       ('public.billing_subscriptions'::regclass, 'public.billing_payments'::regclass, 'public.asaas_webhook_events'::regclass)));
  perform pg_temp._ck('S8 execucao: webhook e verificador de token so para anon; begin e bloqueio para authenticated',
    has_function_privilege('anon', 'public.process_asaas_webhook(text,text,text,timestamptz,text,text,text,numeric,date,timestamptz,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.process_asaas_webhook(text,text,text,timestamptz,text,text,text,numeric,date,timestamptz,text)', 'EXECUTE')
    and has_function_privilege('anon', 'public.billing_webhook_token_valid(text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.billing_webhook_token_valid(text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.billing_begin_subscription(uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.billing_begin_subscription(uuid,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.master_set_billing_block(uuid,boolean,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.master_set_billing_block(uuid,boolean,text)', 'EXECUTE'));
  perform pg_temp._ck('S8 registro de ids e reconciliacao: SO service_role (nem authenticated nem anon)',
    has_function_privilege('service_role', 'public.billing_attach_provider_subscription(uuid,text,text,numeric)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.billing_attach_provider_subscription(uuid,text,text,numeric)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.billing_attach_provider_subscription(uuid,text,text,numeric)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.billing_reconcile_payment(text,text,text,text,text,boolean,numeric,date,timestamptz,timestamptz)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.billing_reconcile_payment(text,text,text,text,text,boolean,numeric,date,timestamptz,timestamptz)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.billing_reconcile_payment(text,text,text,text,text,boolean,numeric,date,timestamptz,timestamptz)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.billing_reconcile_subscription(text,text,text,text,boolean)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.billing_reconcile_subscription(text,text,text,text,boolean)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.billing_reconcile_subscription(text,text,text,text,boolean)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.billing_list_reconcilable(integer,text[])', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.billing_list_reconcilable(integer,text[])', 'EXECUTE')
    and not has_function_privilege('anon', 'public.billing_list_reconcilable(integer,text[])', 'EXECUTE'));
  perform pg_temp._ck('S8 funcoes internas nao sao executaveis por anon/authenticated',
    (select count(*) = 9 and bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
       from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('_billing_apply_core', '_billing_recompute', '_billing_sync_restaurant', '_billing_ledger_finish',
                          '_billing_current_subscription', '_billing_has_paid_plan', '_restaurant_access_state',
                          '_billing_payment_may_transition', '_billing_map_asaas_payment_status')));
  perform pg_temp._ck('S8 toda funcao de cobranca SECURITY DEFINER tem search_path fixo',
    (select count(*) = 15 and bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'))
       from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('_billing_apply_core', '_billing_recompute', '_billing_sync_restaurant', '_billing_ledger_finish',
                          '_billing_current_subscription', '_billing_has_paid_plan', 'billing_begin_subscription',
                          'billing_attach_provider_subscription', 'billing_webhook_token_valid', 'process_asaas_webhook',
                          'billing_list_reconcilable', 'billing_reconcile_payment', 'billing_reconcile_subscription',
                          'master_set_billing_block', '_restaurant_access_state')));
  perform pg_temp._ck('S8 nao existe mais nenhuma sobrecarga antiga de process_asaas_webhook nem start_restaurant_subscription',
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'process_asaas_webhook') = 1
    and not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'start_restaurant_subscription'));
  perform pg_temp._ck('S8 tabela de transicoes: casos criticos (terminal, reversiveis so com horario mais novo)',
    not public._billing_payment_may_transition('refunded', 'confirmed', now() + interval '1 day', now())
    and not public._billing_payment_may_transition('confirmed', 'overdue', now() + interval '1 day', now())
    and not public._billing_payment_may_transition('confirmed', 'pending', now() + interval '1 day', now())
    and public._billing_payment_may_transition('pending', 'confirmed', null, now())
    and public._billing_payment_may_transition('overdue', 'confirmed', null, now())
    and not public._billing_payment_may_transition('overdue', 'pending', null, now())
    and public._billing_payment_may_transition('overdue', 'pending', now() + interval '1 second', now())
    and not public._billing_payment_may_transition('chargeback', 'confirmed', now() - interval '1 second', now())
    and public._billing_payment_may_transition('chargeback', 'confirmed', now() + interval '1 second', now())
    and not public._billing_payment_may_transition('deleted', 'confirmed', now() + interval '1 day', now()));
  perform pg_temp._ck('S8 mapeamento de status do Asaas (API) para o estado interno',
    public._billing_map_asaas_payment_status('CONFIRMED', false) = 'confirmed'
    and public._billing_map_asaas_payment_status('RECEIVED', false) = 'confirmed'
    and public._billing_map_asaas_payment_status('RECEIVED_IN_CASH', false) = 'confirmed'
    and public._billing_map_asaas_payment_status('PENDING', false) = 'pending'
    and public._billing_map_asaas_payment_status('OVERDUE', false) = 'overdue'
    and public._billing_map_asaas_payment_status('REFUNDED', false) = 'refunded'
    and public._billing_map_asaas_payment_status('CHARGEBACK_DISPUTE', false) = 'chargeback'
    and public._billing_map_asaas_payment_status('CONFIRMED', true) = 'deleted'
    and public._billing_map_asaas_payment_status('REFUND_IN_PROGRESS', false) is null
    and public._billing_map_asaas_payment_status('qualquer-coisa', false) is null);

  begin
    insert into public.billing_subscriptions (restaurant_id, plan_id, amount, currency) values (sb[2], v_plan, 10, 'USD');
    perform pg_temp._ck('S8 moeda USD e recusada (check currency)', false);
  exception when check_violation then perform pg_temp._ck('S8 moeda USD e recusada (check currency)', true);
  end;
  begin
    insert into public.billing_subscriptions (restaurant_id, plan_id, amount) values (sb[2], v_plan, 0);
    perform pg_temp._ck('S8 valor zero e recusado (check amount)', false);
  exception when check_violation then perform pg_temp._ck('S8 valor zero e recusado (check amount)', true);
  end;
  begin
    insert into public.billing_subscriptions (restaurant_id, plan_id, amount, provider) values (sb[2], v_plan, 10, 'stripe');
    perform pg_temp._ck('S8 provedor nao habilitado e recusado (check provider; ampliar exige migration)', false);
  exception when check_violation then perform pg_temp._ck('S8 provedor nao habilitado e recusado (check provider; ampliar exige migration)', true);
  end;
  begin
    insert into public.billing_subscriptions (restaurant_id, plan_id, amount, status, activated_at) values (sb[2], v_plan, 10, 'active', now());
    perform pg_temp._ck('S8 "active" sem ids do provedor e recusado pelo banco', false);
  exception when check_violation then perform pg_temp._ck('S8 "active" sem ids do provedor e recusado pelo banco', true);
  end;
  begin
    insert into public.billing_subscriptions (restaurant_id, plan_id, amount, status, provider_customer_id, provider_subscription_id)
    values (sb[2], v_plan, 10, 'active', 'cus_000000000Z01', 'sub_000000000Z01');
    perform pg_temp._ck('S8 "active" sem activated_at e recusado pelo banco', false);
  exception when check_violation then perform pg_temp._ck('S8 "active" sem activated_at e recusado pelo banco', true);
  end;
  begin
    insert into public.billing_subscriptions (restaurant_id, plan_id, amount, admin_blocked_at) values (sb[2], v_plan, 10, now());
    perform pg_temp._ck('S8 bloqueio administrativo sem motivo e recusado pelo banco', false);
  exception when check_violation then perform pg_temp._ck('S8 bloqueio administrativo sem motivo e recusado pelo banco', true);
  end;
  begin
    insert into public.billing_subscriptions (restaurant_id, plan_id, amount) values (sd[2], v_plan, 10);
    perform pg_temp._ck('S8 duas assinaturas vivas na mesma loja sao impossiveis (indice unico)', false);
  exception when unique_violation then perform pg_temp._ck('S8 duas assinaturas vivas na mesma loja sao impossiveis (indice unico)', true);
  end;
  perform pg_temp._ck('S8 plano em uso por assinatura nao pode ser excluido (restrict)',
    pg_temp._run(u_master, format('delete from public.plans where id = %L returning id::text', v_plan)) like '%violates foreign key%');

  -- cortesia de trial (Master) com assinatura só pending: continua valendo
  r := pg_temp._run(u_master, format('select public.master_extend_trial(%L, 7)::text', sh[2]));
  perform pg_temp._ck('S8 CORTESIA preservada: Master prorroga o teste de loja com assinatura apenas pending',
    r not like 'ERR:%' and public._restaurant_access_state(sh[2]) is null);
  perform pg_temp._ck('S8 cortesia continua recusada para loja com plano PAGO (has_plan)',
    pg_temp._run(u_master, format('select public.master_extend_trial(%L, 7)::text', sd[2])) like '%has_plan%');
  perform pg_temp._ck('S8 metrica de conversao do teste nao conta pending',
    pg_get_functiondef('public.master_metrics(integer)'::regprocedure) not like '%in (''active'', ''pending'')%');
  perform pg_temp._ck('S8 master_metrics continua executando para o master',
    pg_temp._run(u_master, 'select (public.master_metrics(30) -> ''trial'' ->> ''converted'')') ~ '^[0-9]+$');

  -- ============================================================
  -- S9 — pronto para vários provedores (estrutura)
  -- ============================================================
  perform pg_temp._ck('S9 assinaturas, cobrancas e eventos guardam o provedor de ORIGEM',
    (select count(*) = 3 from information_schema.columns
      where table_schema = 'public' and column_name = 'provider'
        and table_name in ('billing_subscriptions', 'billing_payments', 'asaas_webhook_events')));
  perform pg_temp._ck('S9 todas as linhas existentes carregam provider = asaas',
    not exists (select 1 from public.billing_subscriptions where provider <> 'asaas')
    and not exists (select 1 from public.billing_payments where provider <> 'asaas')
    and not exists (select 1 from public.asaas_webhook_events where provider <> 'asaas'));
  perform pg_temp._ck('S9 unicidade de ids e por (provider, id): outro provedor pode reutilizar o mesmo texto',
    exists (select 1 from pg_indexes where tablename = 'billing_subscriptions' and indexdef like '%(provider, provider_subscription_id)%')
    and exists (select 1 from pg_constraint where conrelid = 'public.billing_payments'::regclass and contype = 'u'
                and pg_get_constraintdef(oid) like '%(provider, provider_payment_id)%')
    and exists (select 1 from pg_constraint where conrelid = 'public.asaas_webhook_events'::regclass and contype = 'u'
                and pg_get_constraintdef(oid) like '%(provider, asaas_event_id)%'));
  update public.plans set price = 99.90 where id = v_plan;
  perform pg_temp._ck('S9 o valor e o provedor ficam fixados na assinatura quando o plano muda de preco depois',
    (select amount = 49.90 and provider = 'asaas' from public.billing_subscriptions where provider_subscription_id = 'sub_000000000D02'));

  -- ---------- relatório ----------
  select count(*), coalesce(array_agg(k.label order by k.ord) filter (where not k.ok), '{}')
    into total, fails from _ck k;
  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes', total;
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %', array_length(fails, 1), total, array_to_string(fails, ' ## ');
  end if;
end $$;
