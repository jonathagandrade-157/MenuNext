-- MenuNext — teste de regressão do Mercado Pago como provedor da assinatura
-- (extensão da P1-01: migration 20261014000000_billing_mercadopago_provider).
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
--   M1  escolha do provedor (só o Master) e imposição no banco
--   M2  registro da assinatura (formato, valor, referência) e acesso
--   M3  eventos do Mercado Pago: só service_role, pagamento libera, valores e vínculo
--   M4  atraso, estorno, chargeback, cancelamento
--   M5  evento antes do registro (corrida) e idempotência
--   M6  reconciliação com a API
--   M7  convivência com o Asaas (mesmo texto de id em provedores diferentes)
--   M8  catálogo, privilégios e mapeamento de status
-- Nenhuma credencial nem pagamento real: o "Mercado Pago" é simulado por
-- chamadas às RPCs; o "backend" é a persona service_role.

drop table if exists pg_temp._ck;
create temp table _ck (ord serial, label text, ok boolean);

create or replace function pg_temp._ck(p_label text, p_ok boolean) returns void
language sql as $$ insert into _ck (label, ok) values (p_label, coalesce(p_ok, false)) $$;

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

create or replace function pg_temp._run(p_uid uuid, p_stmt text) returns text
language sql as $$
  select pg_temp._runas(case when p_uid is null then 'anon' else 'authenticated' end, p_uid, p_stmt)
$$;

create or replace function pg_temp._svc(p_stmt text) returns text
language sql as $$ select pg_temp._runas('service_role', null, p_stmt) $$;

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

create or replace function pg_temp._store(p_key int, p_trial_expired boolean) returns uuid[]
language plpgsql as $$
declare v_uid uuid := gen_random_uuid(); v_rid uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values (v_uid, 'mp-' || p_key || '@sub.test',
    jsonb_build_object('name', 'Dono MP ' || p_key, 'phone', '1198' || lpad(p_key::text, 7, '0'), 'document', pg_temp._cpf(200 + p_key)));
  insert into public.restaurants (name, slug) values ('Loja MP ' || p_key, 'sub-mp-' || p_key) returning id into v_rid;
  insert into public.restaurant_members (restaurant_id, user_id, role) values (v_rid, v_uid, 'OWNER');
  if p_trial_expired then
    update public.profiles set trial_ends_at = now() - interval '1 day' where user_id = v_uid;
  end if;
  return array[v_uid, v_rid];
end $$;

-- Abre a assinatura como OWNER (provedor explícito) e devolve o id interno ou o erro.
create or replace function pg_temp._begin(p_uid uuid, p_plan uuid, p_provider text) returns text
language sql as $$
  select pg_temp._run(p_uid, format('select out_subscription_id::text from public.billing_begin_subscription(%L, %L)', p_plan, p_provider))
$$;

-- Registro pelo backend. Para o Mercado Pago o "cliente" é o id interno da assinatura.
create or replace function pg_temp._attach(p_id text, p_cus text, p_sub text, p_amount numeric default 49.90) returns text
language sql as $$
  select coalesce(nullif(pg_temp._svc(format('select public.billing_attach_provider_subscription(%L, %L, %L, %L)::text', p_id, p_cus, p_sub, p_amount)), ''), 'OK')
$$;

-- Fluxo legítimo completo com o Mercado Pago.
create or replace function pg_temp._subscribe_mp(p_uid uuid, p_plan uuid, p_sub text) returns text
language plpgsql as $$
declare v_id text;
begin
  v_id := pg_temp._begin(p_uid, p_plan, 'mercadopago');
  if v_id like 'ERR:%' then return v_id; end if;
  return pg_temp._attach(v_id, v_id, p_sub);
end $$;

-- Evento do Mercado Pago (processado pelo backend, service_role).
create or replace function pg_temp._mp(p_evt text, p_kind text, p_sub text, p_cus text, p_ext text,
                                       p_substatus text, p_pay text, p_paystatus text, p_val numeric,
                                       p_due date default null, p_occ timestamptz default null)
returns text language sql as $$
  select pg_temp._svc(format('select public.process_mercadopago_event(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L)',
                             p_evt, p_kind, p_occ, p_sub, p_cus, p_ext, p_substatus, p_pay, p_paystatus, p_val, p_due, null))
$$;

-- Leitura da API (reconciliação) feita pelo backend.
create or replace function pg_temp._rec_pay(p_provider text, p_sub text, p_cus text, p_pay text, p_status text, p_val numeric,
                                            p_due date default null, p_deleted boolean default false)
returns text language sql as $$
  select pg_temp._svc(format('select public.billing_reconcile_payment(%L, %L, %L, %L, %L, %L, %L, %L, null)',
                             p_provider, p_sub, p_cus, p_pay, p_status, p_deleted, p_val, p_due))
$$;

do $$
declare
  v_plan uuid;
  sa uuid[]; sb uuid[]; sc uuid[]; sd uuid[]; se uuid[]; sf uuid[]; sg uuid[]; sh uuid[]; si uuid[];
  u_staff uuid := gen_random_uuid(); u_master uuid := gen_random_uuid();
  r text; r2 text; v_id text; v_id2 text; h1 text;
  fails text[] := '{}'; total int := 0;
begin
  -- Regra de escrita deste arquivo: toda chamada que GRAVA e a leitura do estado
  -- ficam em instrucoes separadas (a leitura na mesma expressao enxergaria o banco
  -- de ANTES da gravacao). Por isso cada chamada vai para uma variavel primeiro.

  -- ---------- setup (como dono do banco) ----------
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_staff,  'mp-staff@sub.test',  jsonb_build_object('name','Staff','phone','11999990601','document', pg_temp._cpf(991))),
    (u_master, 'mp-master@sub.test', jsonb_build_object('name','Master','phone','11999990602','document', pg_temp._cpf(992)));
  update public.profiles set is_master = true where user_id = u_master;

  insert into public.plans (name, price) values ('Plano MP', 49.90) returning id into v_plan;

  sa := pg_temp._store(1, true);   -- M1: escolha do provedor
  sb := pg_temp._store(2, true);   -- M2: registro e formato
  sc := pg_temp._store(3, true);   -- M3: eventos e pagamento
  sd := pg_temp._store(4, true);   -- M4: atraso, estorno
  se := pg_temp._store(5, true);   -- M4: cancelamento
  sf := pg_temp._store(6, true);   -- M5: evento antes do registro
  sg := pg_temp._store(7, true);   -- M6: reconciliacao
  sh := pg_temp._store(8, true);   -- M7: convivencia com o Asaas
  si := pg_temp._store(9, true);   -- M1: restaurante com Asaas (historico preservado)
  insert into public.restaurant_members (restaurant_id, user_id, role) values (sa[2], u_staff, 'STAFF');

  -- ============================================================
  -- M1 — escolha do provedor
  -- ============================================================
  perform pg_temp._ck('M1 provedor padrao e asaas (nada muda ate o Master escolher)',
    (select subscription_provider = 'asaas' from public.billing_settings where id = true));
  r := pg_temp._run(sa[1], 'select public.billing_subscription_provider()');
  r2 := pg_temp._run(null, 'select public.billing_subscription_provider()');
  perform pg_temp._ck('M1 OWNER le o provedor ativo; anonimo nao', r = 'asaas' and r2 like '%permission denied%');

  perform pg_temp._ck('M1 OWNER NAO consegue abrir assinatura pelo Mercado Pago enquanto o Master escolheu Asaas',
    pg_temp._begin(sa[1], v_plan, 'mercadopago') like '%invalid_provider%');
  r := pg_temp._begin(sa[1], v_plan, 'stripe');
  perform pg_temp._ck('M1 provedor desconhecido e recusado', r like '%invalid_provider%');

  r := pg_temp._run(si[1], format('select out_provider from public.billing_begin_subscription(%L)', v_plan));
  perform pg_temp._ck('M1 sem informar o provedor (como a P1-01 chamava), o banco usa o escolhido (asaas) e devolve out_provider',
    r = 'asaas'
    and exists (select 1 from public.billing_subscriptions where restaurant_id = si[2] and provider = 'asaas' and status = 'initiated'));

  r := pg_temp._run(sa[1], 'select public.master_set_subscription_provider(''mercadopago'')');
  r2 := pg_temp._run(u_staff, 'select public.master_set_subscription_provider(''mercadopago'')');
  h1 := pg_temp._run(null, 'select public.master_set_subscription_provider(''mercadopago'')');
  perform pg_temp._ck('M1 so o MASTER troca o provedor (OWNER, STAFF e anonimo recusados; nada muda)',
    r like '%not_authorized%' and r2 like '%not_authorized%' and h1 like '%permission denied%'
    and (select subscription_provider = 'asaas' from public.billing_settings where id = true));
  r := pg_temp._run(u_master, 'select public.master_set_subscription_provider(''stripe'')');
  r2 := pg_temp._run(u_master, 'select public.master_set_subscription_provider(null)');
  perform pg_temp._ck('M1 Master nao define provedor invalido nem nulo',
    r like '%invalid_provider%' and r2 like '%invalid_provider%'
    and (select subscription_provider = 'asaas' from public.billing_settings where id = true));
  r := pg_temp._run(u_master, 'select public.master_set_subscription_provider(''mercadopago'')');
  perform pg_temp._ck('M1 Master escolhe o Mercado Pago', r = 'mercadopago'
    and pg_temp._run(sa[1], 'select public.billing_subscription_provider()') = 'mercadopago');

  r := pg_temp._begin(sa[1], v_plan, 'asaas');
  perform pg_temp._ck('M1 com Mercado Pago escolhido, o OWNER nao consegue forcar o Asaas', r like '%invalid_provider%');
  r2 := pg_temp._run(sa[1], format('select out_provider from public.billing_begin_subscription(%L)', v_plan));
  perform pg_temp._ck('M1 com Mercado Pago escolhido, sem informar o provedor o banco usa o Mercado Pago', r2 = 'mercadopago');
  r := pg_temp._begin(sa[1], v_plan, 'mercadopago');
  perform pg_temp._ck('M1 OWNER abre assinatura pelo Mercado Pago: initiated, valor e moeda do PLANO',
    r not like 'ERR:%'
    and exists (select 1 from public.billing_subscriptions where id = r::uuid and provider = 'mercadopago'
                and status = 'initiated' and amount = 49.90 and currency = 'BRL' and plan_id = v_plan));
  perform pg_temp._ck('M1 STAFF nao abre assinatura', pg_temp._begin(u_staff, v_plan, 'mercadopago') like '%not_authorized%');
  perform pg_temp._ck('M1 a assinatura Asaas anterior (initiated) mantem o provedor de origem',
    exists (select 1 from public.billing_subscriptions where restaurant_id = si[2] and provider = 'asaas'));

  -- ============================================================
  -- M2 — registro da assinatura (loja B)
  -- ============================================================
  v_id := pg_temp._begin(sb[1], v_plan, 'mercadopago');
  perform pg_temp._ck('M2 OWNER abre a assinatura do Mercado Pago', v_id not like 'ERR:%');
  perform pg_temp._ck('M2 OWNER NAO registra ids do provedor: so o backend',
    pg_temp._run(sb[1], format('select public.billing_attach_provider_subscription(%L, %L, %L, 49.90)::text', v_id, v_id, 'MPpre00000000B1')) like '%permission denied%');
  perform pg_temp._ck('M2 "cliente" diferente do id da assinatura do MenuNext e recusado',
    pg_temp._attach(v_id, '123456789', 'MPpre00000000B1') like '%invalid_provider_reference%'
    and pg_temp._attach(v_id, null, 'MPpre00000000B1') like '%invalid_provider_reference%'
    and pg_temp._attach(v_id, gen_random_uuid()::text, 'MPpre00000000B1') like '%invalid_provider_reference%');
  perform pg_temp._ck('M2 id da assinatura em formato invalido e recusado (curto, simbolos, nulo, formato do Asaas)',
    pg_temp._attach(v_id, v_id, 'curto') like '%invalid_provider_reference%'
    and pg_temp._attach(v_id, v_id, 'MPpre0000000;drop') like '%invalid_provider_reference%'
    and pg_temp._attach(v_id, v_id, null) like '%invalid_provider_reference%'
    and pg_temp._attach(v_id, v_id, 'sub_000000000B01') like '%invalid_provider_reference%');
  perform pg_temp._ck('M2 valor conferido diferente do plano e recusado',
    pg_temp._attach(v_id, v_id, 'MPpre00000000B1', 1.00) like '%amount_mismatch%'
    and pg_temp._attach(v_id, v_id, 'MPpre00000000B1', null) like '%amount_mismatch%');
  perform pg_temp._ck('M2 nenhuma tentativa invalida alterou a assinatura',
    (select status = 'initiated' and provider_subscription_id is null from public.billing_subscriptions where id = v_id::uuid));
  r := pg_temp._attach(v_id, v_id, 'MPpre00000000B1');
  perform pg_temp._ck('M2 registro valido: pending, com o id do Mercado Pago', r = 'OK'
    and (select status = 'pending' and provider_customer_id = v_id and provider_subscription_id = 'MPpre00000000B1'
           from public.billing_subscriptions where id = v_id::uuid));
  perform pg_temp._ck('M2 pending NAO libera acesso: loja continua bloqueada',
    public._restaurant_access_state(sb[2]) = 'trial_expired');
  r := pg_temp._run(sb[1], 'select out_provider || '':'' || out_subscription_ref || '':'' || out_amount::text from public.billing_pending_subscription()');
  perform pg_temp._ck('M2 OWNER enxerga a propria assinatura pendente (para retomar o pagamento)',
    r = 'mercadopago:MPpre00000000B1:49.90');
  r := pg_temp._run(sa[1], 'select count(*)::text from public.billing_pending_subscription()');
  r2 := pg_temp._run(u_staff, 'select count(*)::text from public.billing_pending_subscription()');
  h1 := pg_temp._run(null, 'select count(*)::text from public.billing_pending_subscription()');
  perform pg_temp._ck('M2 pendente e so do OWNER dono: outro restaurante, STAFF e anonimo nao a enxergam (initiated tambem nao)',
    r = '0' and r2 = '0' and h1 like '%permission denied%');
  perform pg_temp._ck('M2 espelho do restaurante: pending, sem ids do Asaas',
    (select subscription_status = 'pending' and asaas_subscription_id is null and asaas_customer_id is null
       from public.restaurants where id = sb[2]));
  perform pg_temp._ck('M2 registrar de novo a mesma assinatura e recusado (estado invalido)',
    pg_temp._attach(v_id, v_id, 'MPpre00000000B1') like '%invalid_state%');
  v_id2 := pg_temp._begin(sc[1], v_plan, 'mercadopago');
  r := pg_temp._attach(v_id2, v_id2, 'MPpre00000000B1');
  perform pg_temp._ck('M2 outra assinatura nao reutiliza o id do Mercado Pago (provider_reference_in_use)',
    r like '%provider_reference_in_use%'
    and (select status = 'initiated' from public.billing_subscriptions where id = v_id2::uuid));

  -- ============================================================
  -- M3 — eventos e pagamento confirmado (loja C; assinatura aberta acima)
  -- ============================================================
  v_id := v_id2;
  r := pg_temp._attach(v_id, v_id, 'MPpre00000000C1');
  perform pg_temp._ck('M3 loja C registrada (pending) e bloqueada', r = 'OK'
    and public._restaurant_access_state(sc[2]) = 'trial_expired');

  r := pg_temp._run(null, format('select public.process_mercadopago_event(%L, %L, null, %L, %L, %L, null, null, null, null, null, null)', 'evt-x1', 'preapproval', 'MPpre00000000C1', v_id, v_id));
  r2 := pg_temp._run(sc[1], format('select public.process_mercadopago_event(%L, %L, null, %L, %L, %L, null, null, null, null, null, null)', 'evt-x2', 'preapproval', 'MPpre00000000C1', v_id, v_id));
  h1 := pg_temp._run(u_master, format('select public.process_mercadopago_event(%L, %L, null, %L, %L, %L, null, null, null, null, null, null)', 'evt-x3', 'preapproval', 'MPpre00000000C1', v_id, v_id));
  perform pg_temp._ck('M3 evento SO por service_role: anonimo, OWNER e Master nao executam',
    r like '%permission denied%' and r2 like '%permission denied%' and h1 like '%permission denied%');
  r := pg_temp._mp('', 'preapproval', 'MPpre00000000C1', v_id, v_id, 'authorized', null, null, null);
  r2 := pg_temp._mp('evt-c-0', 'payment', 'MPpre00000000C1', v_id, v_id, 'authorized', null, null, null);
  h1 := pg_temp._mp(null, 'preapproval', 'MPpre00000000C1', v_id, v_id, 'authorized', null, null, null);
  perform pg_temp._ck('M3 evento invalido (sem id, tipo desconhecido) levanta invalid_event',
    r like '%invalid_event%' and r2 like '%invalid_event%' and h1 like '%invalid_event%');

  h1 := pg_temp._mp('mp:c-1', 'preapproval', 'MPpre00000000C1', v_id, v_id, 'authorized', null, null, null);
  perform pg_temp._ck('M3 assinatura autorizada (sem fatura) nao tem efeito sobre o acesso', h1 = 'ignored'
    and public._restaurant_access_state(sc[2]) = 'trial_expired');

  h1 := pg_temp._mp('mp:c-2', 'authorized_payment', 'MPpre00000000C1', v_id, v_id, null, '9001', 'scheduled/', 49.90, '2026-10-10');
  perform pg_temp._ck('M3 fatura agendada e registrada como pending; loja segue bloqueada', h1 = 'applied'
    and (select status = 'pending' and current_period_end is null from public.billing_subscriptions where provider_subscription_id = 'MPpre00000000C1')
    and public._restaurant_access_state(sc[2]) = 'trial_expired');

  h1 := pg_temp._mp('mp:c-3', 'authorized_payment', 'MPpre00000000C1', v_id, v_id, null, '9001', 'scheduled/approved', 49.90, '2026-10-10');
  perform pg_temp._ck('M3 pagamento aprovado mas fatura ainda nao processada NAO confirma', h1 in ('ignored', 'noop')
    and public._restaurant_access_state(sc[2]) = 'trial_expired');
  h1 := pg_temp._mp('mp:c-4', 'authorized_payment', 'MPpre00000000C1', v_id, v_id, null, '9001', 'processed/pending', 49.90, '2026-10-10');
  perform pg_temp._ck('M3 fatura processada sem pagamento aprovado NAO confirma', h1 = 'noop'
    and public._restaurant_access_state(sc[2]) = 'trial_expired');

  perform pg_temp._ck('M3 confirmacao com VALOR MENOR que o plano e rejeitada',
    pg_temp._mp('mp:c-5', 'authorized_payment', 'MPpre00000000C1', v_id, v_id, null, '9001', 'processed/approved', 10.00, '2026-10-10') = 'value_mismatch');
  perform pg_temp._ck('M3 confirmacao sem valor e rejeitada',
    pg_temp._mp('mp:c-6', 'authorized_payment', 'MPpre00000000C1', v_id, v_id, null, '9001', 'processed/approved', null, '2026-10-10') = 'value_mismatch');
  perform pg_temp._ck('M3 confirmacao com "cliente" (ref. externa) de OUTRA assinatura e rejeitada',
    pg_temp._mp('mp:c-7', 'authorized_payment', 'MPpre00000000C1', gen_random_uuid()::text, v_id, null, '9001', 'processed/approved', 49.90, '2026-10-10') = 'customer_mismatch');
  perform pg_temp._ck('M3 confirmacao com referencia externa de OUTRA assinatura e rejeitada',
    pg_temp._mp('mp:c-8', 'authorized_payment', 'MPpre00000000C1', v_id, '00000000-0000-4000-8000-000000000000', null, '9001', 'processed/approved', 49.90, '2026-10-10') = 'reference_mismatch');
  perform pg_temp._ck('M3 assinatura desconhecida: fica como unmatched, sem efeito',
    pg_temp._mp('mp:c-9', 'authorized_payment', 'MPdesconhecido01', v_id, v_id, null, '9999', 'processed/approved', 49.90, '2026-10-10') = 'unmatched');
  perform pg_temp._ck('M3 nenhuma tentativa invalida liberou a loja',
    public._restaurant_access_state(sc[2]) = 'trial_expired'
    and not exists (select 1 from public.billing_payments where provider_payment_id = '9001' and status = 'confirmed'));

  h1 := pg_temp._mp('mp:c-10', 'authorized_payment', 'MPpre00000000C1', v_id, v_id, null, '9001', 'processed/approved', 49.90, '2026-10-10');
  perform pg_temp._ck('M3 fatura processada E pagamento aprovado, valor do plano: aplicado', h1 = 'applied');
  perform pg_temp._ck('M3 pagamento confirmado: assinatura ACTIVE, loja LIBERADA, periodo 1 mes apos o vencimento',
    (select status = 'active' and activated_at is not null and current_period_end = timestamptz '2026-11-10 00:00:00-03'
       from public.billing_subscriptions where provider_subscription_id = 'MPpre00000000C1')
    and (select subscription_status = 'active' and plan_id = v_plan from public.restaurants where id = sc[2])
    and public._restaurant_access_state(sc[2]) is null);

  h1 := pg_temp._mp('mp:c-10', 'authorized_payment', 'MPpre00000000C1', v_id, v_id, null, '9001', 'processed/approved', 49.90, '2026-10-10');
  perform pg_temp._ck('M3 MESMO evento reenviado (duplicado) e ignorado', h1 = 'duplicate');
  h1 := pg_temp._mp('mp:c-11', 'authorized_payment', 'MPpre00000000C1', v_id, v_id, null, '9001', 'processed/approved', 49.90, '2026-10-10');
  perform pg_temp._ck('M3 outro evento da MESMA fatura e no-op: uma linha so, mesmo periodo', h1 = 'noop'
    and (select count(*) from public.billing_payments where provider = 'mercadopago' and provider_payment_id = '9001') = 1
    and (select current_period_end = timestamptz '2026-11-10 00:00:00-03' from public.billing_subscriptions where provider_subscription_id = 'MPpre00000000C1'));

  -- ============================================================
  -- M4 — atraso, estorno, chargeback, cancelamento
  -- ============================================================
  r := pg_temp._subscribe_mp(sd[1], v_plan, 'MPpre00000000D1');
  v_id := (select id::text from public.billing_subscriptions where restaurant_id = sd[2]);
  h1 := pg_temp._mp('mp:d-1', 'authorized_payment', 'MPpre00000000D1', v_id, v_id, null, '9101', 'processed/approved', 49.90, '2026-10-10');
  perform pg_temp._ck('M4 loja D paga e liberada', r = 'OK' and h1 = 'applied' and public._restaurant_access_state(sd[2]) is null);

  h1 := pg_temp._mp('mp:d-2', 'authorized_payment', 'MPpre00000000D1', v_id, v_id, null, '9102', 'scheduled/', 49.90, '2026-11-10');
  perform pg_temp._ck('M4 renovacao agendada (pending) nao tira o acesso', h1 = 'applied' and public._restaurant_access_state(sd[2]) is null);
  h1 := pg_temp._mp('mp:d-3', 'authorized_payment', 'MPpre00000000D1', v_id, v_id, null, '9102', 'recycling/rejected', 49.90, '2026-11-10');
  perform pg_temp._ck('M4 cobranca da renovacao recusada: assinatura OVERDUE e loja bloqueada', h1 = 'applied'
    and (select status = 'overdue' from public.billing_subscriptions where provider_subscription_id = 'MPpre00000000D1')
    and public._restaurant_access_state(sd[2]) = 'overdue');
  h1 := pg_temp._mp('mp:d-4', 'authorized_payment', 'MPpre00000000D1', v_id, v_id, null, '9102', 'processed/approved', 49.90, '2026-11-10');
  perform pg_temp._ck('M4 nova tentativa aprovada reativa a loja e avanca o periodo (2026-12-10)', h1 = 'applied'
    and (select status = 'active' and current_period_end = timestamptz '2026-12-10 00:00:00-03'
           from public.billing_subscriptions where provider_subscription_id = 'MPpre00000000D1')
    and public._restaurant_access_state(sd[2]) is null);
  h1 := pg_temp._mp('mp:d-5', 'authorized_payment', 'MPpre00000000D1', v_id, v_id, null, '9102', 'recycling/rejected', 49.90, '2026-11-10');
  perform pg_temp._ck('M4 FORA DE ORDEM: recusa que chega depois da confirmacao e ignorada (stale)', h1 = 'stale'
    and public._restaurant_access_state(sd[2]) is null);

  h1 := pg_temp._mp('mp:d-6', 'authorized_payment', 'MPpre00000000D1', v_id, v_id, null, '9102', 'processed/refunded', 49.90, '2026-11-10');
  perform pg_temp._ck('M4 estorno de UMA fatura nao cancela a assinatura e o 1o mes continua pago', h1 = 'applied'
    and (select status <> 'cancelled' from public.billing_subscriptions where provider_subscription_id = 'MPpre00000000D1')
    and public._restaurant_access_state(sd[2]) is null);
  h1 := pg_temp._mp('mp:d-7', 'authorized_payment', 'MPpre00000000D1', v_id, v_id, null, '9101', 'processed/charged_back', 49.90, '2026-10-10');
  perform pg_temp._ck('M4 chargeback da unica fatura paga remove o acesso pago', h1 = 'applied'
    and public._restaurant_access_state(sd[2]) = 'trial_expired');

  r := pg_temp._subscribe_mp(se[1], v_plan, 'MPpre00000000E1');
  v_id := (select id::text from public.billing_subscriptions where restaurant_id = se[2]);
  h1 := pg_temp._mp('mp:e-1', 'authorized_payment', 'MPpre00000000E1', v_id, v_id, null, '9201', 'processed/approved', 49.90, '2026-10-10');
  perform pg_temp._ck('M4 loja E paga e liberada', r = 'OK' and h1 = 'applied' and public._restaurant_access_state(se[2]) is null);
  h1 := pg_temp._mp('mp:e-2', 'preapproval', 'MPpre00000000E1', v_id, v_id, 'paused', null, null, null);
  perform pg_temp._ck('M4 assinatura PAUSADA no Mercado Pago nao cancela por si so', h1 = 'ignored'
    and (select status = 'active' from public.billing_subscriptions where provider_subscription_id = 'MPpre00000000E1'));
  h1 := pg_temp._mp('mp:e-3', 'preapproval', 'MPpre00000000E1', v_id, v_id, 'cancelled', null, null, null);
  perform pg_temp._ck('M4 assinatura CANCELADA: status cancelled, periodo ja pago preservado', h1 = 'cancelled'
    and (select status = 'cancelled' and cancelled_at is not null and current_period_end = timestamptz '2026-11-10 00:00:00-03'
           from public.billing_subscriptions where provider_subscription_id = 'MPpre00000000E1')
    and public._restaurant_access_state(se[2]) is null);
  h1 := pg_temp._mp('mp:e-4', 'preapproval', 'MPpre00000000E1', v_id, v_id, 'cancelled', null, null, null);
  perform pg_temp._ck('M4 cancelar de novo e no-op (already_cancelled)', h1 = 'already_cancelled');

  -- ============================================================
  -- M5 — evento antes do registro (corrida) e idempotência (loja F)
  -- ============================================================
  v_id := pg_temp._begin(sf[1], v_plan, 'mercadopago');
  h1 := pg_temp._mp('mp:f-1', 'authorized_payment', 'MPpre00000000F1', v_id, v_id, null, '9301', 'processed/approved', 49.90, '2026-10-10');
  perform pg_temp._ck('M5 evento que chega ANTES do registro fica unmatched e NAO libera acesso', h1 = 'unmatched'
    and public._restaurant_access_state(sf[2]) = 'trial_expired'
    and not exists (select 1 from public.billing_payments where provider_payment_id = '9301'));
  r := pg_temp._attach(v_id, v_id, 'MPpre00000000F1');
  perform pg_temp._ck('M5 ao registrar, o evento guardado e reaplicado (corrida webhook x registro)', r = 'OK'
    and exists (select 1 from public.billing_payments where provider = 'mercadopago' and provider_payment_id = '9301' and status = 'confirmed')
    and public._restaurant_access_state(sf[2]) is null);
  perform pg_temp._ck('M5 o livro de eventos guarda o provedor e o resultado final',
    exists (select 1 from public.asaas_webhook_events where provider = 'mercadopago' and asaas_event_id = 'mp:f-1' and result = 'applied'));
  h1 := pg_temp._mp('mp:f-1', 'authorized_payment', 'MPpre00000000F1', v_id, v_id, null, '9301', 'processed/approved', 49.90, '2026-10-10');
  perform pg_temp._ck('M5 reenvio do mesmo evento depois da reaplicacao: duplicate', h1 = 'duplicate');

  -- ============================================================
  -- M6 — reconciliação com a API (loja G)
  -- ============================================================
  r := pg_temp._subscribe_mp(sg[1], v_plan, 'MPpre00000000G1');
  v_id := (select id::text from public.billing_subscriptions where restaurant_id = sg[2]);
  perform pg_temp._ck('M6 loja G registrada e bloqueada', r = 'OK' and public._restaurant_access_state(sg[2]) = 'trial_expired');
  h1 := pg_temp._rec_pay('mercadopago', 'MPpre00000000G1', v_id, '9401', 'scheduled/', 49.90, '2026-10-10');
  perform pg_temp._ck('M6 fatura agendada lida na API: pending, nada liberado', h1 = 'applied'
    and public._restaurant_access_state(sg[2]) = 'trial_expired');
  h1 := pg_temp._rec_pay('mercadopago', 'MPpre00000000G1', v_id, '9401', 'processed/pending', 49.90, '2026-10-10');
  perform pg_temp._ck('M6 leitura com pagamento NAO aprovado nao confirma', h1 = 'noop'
    and public._restaurant_access_state(sg[2]) = 'trial_expired');
  h1 := pg_temp._rec_pay('mercadopago', 'MPpre00000000G1', v_id, '9401', 'processed/approved', 49.90, '2026-10-10');
  perform pg_temp._ck('M6 webhook perdido recuperado pela leitura da API: confirmada e liberada', h1 = 'applied'
    and public._restaurant_access_state(sg[2]) is null);
  r := pg_temp._rec_pay('mercadopago', 'MPpre00000000G1', gen_random_uuid()::text, '9402', 'processed/approved', 49.90, '2026-11-10');
  r2 := pg_temp._rec_pay('mercadopago', 'MPpre00000000G1', v_id, '9402', 'processed/approved', 5.00, '2026-11-10');
  perform pg_temp._ck('M6 reconciliacao exige o "cliente" certo e o valor do plano',
    r = 'customer_mismatch' and r2 = 'value_mismatch');
  perform pg_temp._ck('M6 status desconhecido e ignorado',
    pg_temp._rec_pay('mercadopago', 'MPpre00000000G1', v_id, '9403', 'algo_novo/estranho', 49.90, '2026-11-10') = 'ignored');
  r := pg_temp._svc(format('select public.billing_reconcile_subscription(%L, %L, %L, %L, false)', 'mercadopago', 'MPpre00000000G1', v_id, 'authorized'));
  perform pg_temp._ck('M6 leitura marca a assinatura como reconciliada', r = 'active_remote'
    and (select last_reconciled_at is not null from public.billing_subscriptions where provider_subscription_id = 'MPpre00000000G1'));
  perform pg_temp._ck('M6 a lista de reconciliacao inclui as assinaturas do Mercado Pago',
    exists (select 1 from public.billing_list_reconcilable(200) l where l.out_provider = 'mercadopago'));
  r := pg_temp._run(sg[1], format('select public.billing_reconcile_payment(%L, %L, %L, %L, %L, false, 49.90, null, null, null)', 'mercadopago', 'MPpre00000000G1', v_id, '9401', 'processed/approved'));
  r2 := pg_temp._run(null, format('select public.billing_reconcile_subscription(%L, %L, %L, %L, false)', 'mercadopago', 'MPpre00000000G1', v_id, 'cancelled'));
  perform pg_temp._ck('M6 so o backend reconcilia (OWNER e anonimo nao executam)',
    r like '%permission denied%' and r2 like '%permission denied%');
  r := pg_temp._rec_pay('stripe', 'x', 'x', 'x', 'x', 1);
  r2 := pg_temp._svc(format('select public.billing_reconcile_subscription(%L, %L, %L, %L, false)', 'stripe', 'x', 'x', 'x'));
  perform pg_temp._ck('M6 provedor desconhecido na reconciliacao levanta invalid_provider',
    r like '%invalid_provider%' and r2 like '%invalid_provider%');
  r := pg_temp._svc(format('select public.billing_reconcile_subscription(%L, %L, %L, %L, false)', 'mercadopago', 'MPpre00000000G1', v_id, 'cancelled'));
  perform pg_temp._ck('M6 assinatura cancelada na API (ou removida) vira cancelled', r = 'cancelled'
    and (select status = 'cancelled' from public.billing_subscriptions where provider_subscription_id = 'MPpre00000000G1'));

  -- ============================================================
  -- M7 — convivência com o Asaas (loja H)
  -- ============================================================
  -- O Master volta ao Asaas: as assinaturas do Mercado Pago ja existentes NAO mudam.
  r := pg_temp._run(u_master, 'select public.master_set_subscription_provider(''asaas'')');
  perform pg_temp._ck('M7 Master volta ao Asaas', r = 'asaas');
  perform pg_temp._ck('M7 trocar o provedor nao reescreve o historico: assinaturas do Mercado Pago continuam mercadopago',
    (select count(*) > 0 and bool_and(provider = 'mercadopago') from public.billing_subscriptions where provider_subscription_id like 'MPpre%'));
  v_id := pg_temp._begin(sh[1], v_plan, 'asaas');
  r := pg_temp._attach(v_id, 'cus_000000000H01', 'sub_000000000H01');
  perform pg_temp._ck('M7 fluxo do Asaas segue valido apos a migration (formato cus_/sub_ exigido so para o Asaas)', r = 'OK'
    and exists (select 1 from public.billing_subscriptions where id = v_id::uuid and provider = 'asaas' and status = 'pending'));
  h1 := pg_temp._mp('mp:h-1', 'authorized_payment', 'sub_000000000H01', 'cus_000000000H01', null, null, '9501', 'processed/approved', 49.90, '2026-10-10');
  perform pg_temp._ck('M7 um evento do Mercado Pago NAO toca assinatura do Asaas com o mesmo texto de id', h1 = 'unmatched'
    and public._restaurant_access_state(sh[2]) = 'trial_expired');
  h1 := pg_temp._rec_pay('asaas', 'sub_000000000H01', 'cus_000000000H01', 'pay_000000000H01', 'RECEIVED', 49.90, '2026-10-10');
  perform pg_temp._ck('M7 reconciliacao do Asaas continua com o status cru do Asaas', h1 = 'applied'
    and public._restaurant_access_state(sh[2]) is null);

  -- ============================================================
  -- M8 — catálogo, privilégios e mapeamento
  -- ============================================================
  r := pg_temp._svc(format('insert into public.billing_subscriptions (restaurant_id, plan_id, provider, amount) values (%L, %L, %L, 1) returning 1', sh[2], v_plan, 'stripe'));
  perform pg_temp._ck('M8 a tabela aceita so os provedores conhecidos (service_role nao a escreve nem com provedor invalido)',
    r like '%billing_subscriptions_provider_check%' or r like '%permission denied%');
  perform pg_temp._ck('M8 constraint de provedor lista exatamente asaas e mercadopago',
    exists (select 1 from pg_constraint where conrelid = 'public.billing_subscriptions'::regclass
            and conname = 'billing_subscriptions_provider_check'
            and pg_get_constraintdef(oid) like '%asaas%' and pg_get_constraintdef(oid) like '%mercadopago%'
            and pg_get_constraintdef(oid) not like '%stripe%'));
  perform pg_temp._ck('M8 process_mercadopago_event: so service_role executa',
    has_function_privilege('service_role', 'public.process_mercadopago_event(text, text, timestamptz, text, text, text, text, text, text, numeric, date, timestamptz)', 'execute')
    and not has_function_privilege('anon', 'public.process_mercadopago_event(text, text, timestamptz, text, text, text, text, text, text, numeric, date, timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'public.process_mercadopago_event(text, text, timestamptz, text, text, text, text, text, text, numeric, date, timestamptz)', 'execute'));
  perform pg_temp._ck('M8 mapeamento interno nao e executavel pela API',
    not has_function_privilege('anon', 'public._billing_map_mp_payment_status(text, boolean)', 'execute')
    and not has_function_privilege('authenticated', 'public._billing_map_mp_payment_status(text, boolean)', 'execute'));
  perform pg_temp._ck('M8 master_set_subscription_provider so para authenticated (nao anon)',
    has_function_privilege('authenticated', 'public.master_set_subscription_provider(text)', 'execute')
    and not has_function_privilege('anon', 'public.master_set_subscription_provider(text)', 'execute'));
  r := pg_temp._run(sa[1], 'select count(*)::text from public.billing_settings');
  r2 := pg_temp._run(null, 'select count(*)::text from public.billing_settings');
  perform pg_temp._ck('M8 billing_settings segue sem leitura pela API (RLS sem policy: 0 linhas ou permission denied)',
    (r = '0' or r like '%permission denied%') and (r2 = '0' or r2 like '%permission denied%'));

  perform pg_temp._ck('M8 mapeamento: confirmada so com fatura processada E pagamento aprovado',
    public._billing_map_mp_payment_status('processed/approved', false) = 'confirmed'
    and public._billing_map_mp_payment_status('scheduled/approved', false) is null
    and public._billing_map_mp_payment_status('processed/pending', false) = 'pending'
    and public._billing_map_mp_payment_status('processed/', false) = 'pending');
  perform pg_temp._ck('M8 mapeamento: pendente, atraso, estorno, chargeback, removida',
    public._billing_map_mp_payment_status('scheduled/', false) = 'pending'
    and public._billing_map_mp_payment_status('scheduled/in_process', false) = 'pending'
    and public._billing_map_mp_payment_status('recycling/rejected', false) = 'overdue'
    and public._billing_map_mp_payment_status('processed/rejected', false) = 'overdue'
    and public._billing_map_mp_payment_status('processed/refunded', false) = 'refunded'
    and public._billing_map_mp_payment_status('processed/charged_back', false) = 'chargeback'
    and public._billing_map_mp_payment_status('cancelled/', false) = 'deleted'
    and public._billing_map_mp_payment_status('processed/approved', true) = 'deleted');
  perform pg_temp._ck('M8 mapeamento: entradas estranhas nao tem efeito',
    public._billing_map_mp_payment_status(null, false) is null
    and public._billing_map_mp_payment_status('', false) is null
    and public._billing_map_mp_payment_status('algo/estranho', false) is null
    and public._billing_map_mp_payment_status('PROCESSED/APPROVED', false) is null);

  -- ---------- relatório ----------
  select count(*), coalesce(array_agg(k.label order by k.ord) filter (where not k.ok), '{}')
    into total, fails from _ck k;
  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes', total;
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %', array_length(fails, 1), total, array_to_string(fails, ' ## ');
  end if;
end $$;
