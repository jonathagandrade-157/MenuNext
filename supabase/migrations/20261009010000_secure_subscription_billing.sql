-- MenuNext — P1-01: acesso pago só com pagamento confirmado por evento
-- autenticado do provedor.
--
-- MODELO
-- * O banco é a fonte de verdade da assinatura: public.billing_subscriptions
--   (uma por contrato, com provedor, valor e moeda fixados NO BANCO a partir do
--   plano) e public.billing_payments (uma linha por cobrança).
-- * O OWNER só consegue ABRIR uma assinatura "initiated" para um plano ativo
--   (billing_begin_subscription). Quem registra os IDs do provedor é o BACKEND
--   (service_role), depois de ler a assinatura na API autenticada do provedor e
--   conferir cliente, valor e referência (billing_attach_provider_subscription).
--   Nenhuma dessas etapas libera acesso: a assinatura fica 'pending' e a loja
--   segue regida pelo teste gratuito/cortesia.
-- * Quem libera acesso pago é exclusivamente um pagamento confirmado: por
--   webhook autenticado por token (process_asaas_webhook) ou pela reconciliação
--   do backend com a API do provedor (billing_reconcile_*). O status da
--   assinatura é DERIVADO do conjunto de cobranças, e as transições de cada
--   cobrança seguem uma tabela explícita (não uma ordem numérica).
-- * Cancelamento preserva o período já pago; chargeback/estorno removem o
--   período correspondente; bloqueio administrativo (Master) corta na hora.
-- * O provedor fica gravado em cada assinatura/cobrança/evento; trocar o
--   provedor ativo no futuro não reescreve o histórico.
-- * restaurants.plan_id / subscription_status / asaas_* continuam existindo
--   como ESPELHO para telas e métricas, gravado só por funções SECURITY
--   DEFINER (protegido pela migration 20261009000000).
--
-- RECUPERAÇÃO: o procedimento detalhado é mantido em documentação privada do
-- projeto, fora deste repositório público.

-- ============================================================
-- 1. Tabelas
-- ============================================================
create table public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete restrict,
  plan_id uuid not null references public.plans (id) on delete restrict,
  provider text not null default 'asaas' check (provider in ('asaas')),
  provider_customer_id text,
  provider_subscription_id text,
  amount numeric(10, 2) not null check (amount > 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  status text not null default 'initiated'
    check (status in ('initiated', 'pending', 'active', 'overdue', 'cancelled')),
  activated_at timestamptz,
  cancelled_at timestamptz,
  current_period_end timestamptz,
  admin_blocked_at timestamptz,
  admin_blocked_by uuid,
  admin_block_reason text check (admin_block_reason is null or length(admin_block_reason) between 1 and 300),
  last_reconciled_at timestamptz,
  -- clock_timestamp(): ordem estavel entre assinaturas criadas na mesma transacao.
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now(),
  constraint billing_subscriptions_provider_refs_chk check (
    (status = 'initiated' and provider_subscription_id is null)
    or (status <> 'initiated' and provider_subscription_id is not null and provider_customer_id is not null)
  ),
  constraint billing_subscriptions_activated_chk check (status <> 'active' or activated_at is not null),
  constraint billing_subscriptions_block_chk check ((admin_blocked_at is null) = (admin_block_reason is null))
);

-- Um ID do provedor pertence a UMA assinatura.
create unique index billing_subscriptions_provider_ref_idx
  on public.billing_subscriptions (provider, provider_subscription_id)
  where provider_subscription_id is not null;

-- No máximo uma assinatura "viva" por restaurante.
create unique index billing_subscriptions_one_live_idx
  on public.billing_subscriptions (restaurant_id)
  where status in ('initiated', 'pending', 'active', 'overdue');

-- Consulta do estado de acesso (usada em todo pedido): assinatura mais recente da loja.
create index billing_subscriptions_restaurant_idx
  on public.billing_subscriptions (restaurant_id, created_at desc);

create index billing_subscriptions_plan_id_idx on public.billing_subscriptions (plan_id);

create trigger set_updated_at before update on public.billing_subscriptions
  for each row execute function public.set_updated_at();

create table public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.billing_subscriptions (id) on delete restrict,
  provider text not null,
  provider_payment_id text not null,
  amount numeric(10, 2) not null check (amount >= 0),
  status text not null check (status in ('pending', 'overdue', 'confirmed', 'refunded', 'chargeback', 'deleted')),
  due_date date,
  paid_at timestamptz,
  last_event_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_payment_id)
);

create index billing_payments_subscription_id_idx on public.billing_payments (subscription_id);

create trigger set_updated_at before update on public.billing_payments
  for each row execute function public.set_updated_at();

-- Sem policy e sem privilégio: só funções SECURITY DEFINER tocam nestas tabelas.
alter table public.billing_subscriptions enable row level security;
alter table public.billing_payments enable row level security;
revoke all on table public.billing_subscriptions from public, anon, authenticated;
revoke all on table public.billing_payments from public, anon, authenticated;

-- Livro-razão de eventos (idempotência): passa a ser por provedor e a guardar
-- o resultado de cada evento.
alter table public.asaas_webhook_events
  add column provider text not null default 'asaas',
  add column result text,
  add column occurred_at timestamptz;

alter table public.asaas_webhook_events drop constraint if exists asaas_webhook_events_asaas_event_id_key;
alter table public.asaas_webhook_events
  add constraint asaas_webhook_events_provider_event_key unique (provider, asaas_event_id);

-- ============================================================
-- 2. Remove a RPC e o processador de webhook anteriores, substituídos pelas
--    funções abaixo. Assinaturas diferentes: sem DROP ficariam como
--    sobrecargas ainda executáveis.
-- ============================================================
drop function if exists public.start_restaurant_subscription(uuid, text, text);
drop function if exists public.process_asaas_webhook(text, text, text, text, text, timestamptz);

-- ============================================================
-- 3. Assinatura vigente do restaurante (a mais recente que já foi registrada
--    no provedor) — usada pelo espelho e pelo estado de acesso.
-- ============================================================
create or replace function public._billing_current_subscription(p_restaurant_id uuid)
returns public.billing_subscriptions
language sql
stable
security definer
set search_path to 'public'
as $$
  select b.*
  from public.billing_subscriptions b
  where b.restaurant_id = p_restaurant_id and b.status <> 'initiated'
  order by b.created_at desc, b.id
  limit 1;
$$;

revoke all on function public._billing_current_subscription(uuid) from public, anon, authenticated;

-- ============================================================
-- 4. Espelho em restaurants (só funções definer escrevem aqui)
-- ============================================================
create or replace function public._billing_sync_restaurant(p_restaurant_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.billing_subscriptions;
begin
  select * into s from public._billing_current_subscription(p_restaurant_id);
  if s.id is null then
    return;
  end if;

  if s.status = 'cancelled' and s.activated_at is null then
    -- Retirada antes de qualquer pagamento: volta ao estado "sem assinatura".
    update public.restaurants
    set plan_id = null,
        subscription_status = 'active',
        asaas_customer_id = null,
        asaas_subscription_id = null,
        subscription_current_period_end = null
    where id = p_restaurant_id;
  else
    update public.restaurants
    set plan_id = s.plan_id,
        subscription_status = s.status,
        asaas_customer_id = case when s.provider = 'asaas' then s.provider_customer_id else null end,
        asaas_subscription_id = case when s.provider = 'asaas' then s.provider_subscription_id else null end,
        subscription_current_period_end = s.current_period_end
    where id = p_restaurant_id;
  end if;
end;
$$;

revoke all on function public._billing_sync_restaurant(uuid) from public, anon, authenticated;

-- ============================================================
-- 5. Status derivado das cobranças
--    cancelled é terminal (só o período pago é recalculado); nunca-paga não vira
--    overdue (o teste gratuito continua valendo); active exige ao menos uma
--    cobrança confirmada; estorno, chargeback e exclusão não contam como pagas.
-- ============================================================
create or replace function public._billing_recompute(p_subscription_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.billing_subscriptions;
  v_confirmed boolean;
  v_overdue boolean;
  v_max_due date;
  v_period_end timestamptz;
  v_new text;
begin
  select * into s from public.billing_subscriptions where id = p_subscription_id for update;
  if not found or s.status = 'initiated' then
    return;
  end if;

  select coalesce(bool_or(p.status = 'confirmed'), false),
         coalesce(bool_or(p.status = 'overdue'), false),
         max(p.due_date) filter (where p.status = 'confirmed')
  into v_confirmed, v_overdue, v_max_due
  from public.billing_payments p
  where p.subscription_id = p_subscription_id;

  -- O periodo pago termina um mes apos o MAIOR vencimento confirmado (nunca soma
  -- cobrancas duplicadas), em horario de Brasilia.
  v_period_end := case
    when v_max_due is null then null
    else ((v_max_due + interval '1 month')::timestamp at time zone 'America/Sao_Paulo')
  end;

  if s.status = 'cancelled' then
    update public.billing_subscriptions set current_period_end = v_period_end where id = s.id;
    perform public._billing_sync_restaurant(s.restaurant_id);
    return;
  end if;

  if v_overdue and (s.activated_at is not null or v_confirmed) then
    v_new := 'overdue';
  elsif v_confirmed then
    v_new := 'active';
  else
    v_new := 'pending';
  end if;

  update public.billing_subscriptions
  set status = v_new,
      activated_at = case when v_confirmed then coalesce(activated_at, now()) else activated_at end,
      current_period_end = v_period_end
  where id = p_subscription_id;

  perform public._billing_sync_restaurant(s.restaurant_id);
end;
$$;

revoke all on function public._billing_recompute(uuid) from public, anon, authenticated;

-- ============================================================
-- 6. Transições permitidas de uma cobrança (tabela explícita). Transições que
--    "voltam atrás" só valem com um evento comprovadamente MAIS NOVO (horário
--    do próprio evento do provedor; sem horário, nunca valem).
--      pending    -> overdue | confirmed | refunded | chargeback | deleted
--      overdue    -> confirmed | refunded | chargeback | deleted
--                    | pending (vencimento prorrogado; evento mais novo)
--      confirmed  -> refunded | chargeback | deleted
--      chargeback -> refunded | confirmed (disputa ganha; evento mais novo)
--      deleted    -> pending (restaurada; evento mais novo)
--      refunded   -> (terminal)
-- ============================================================
create or replace function public._billing_payment_may_transition(
  p_old text, p_new text, p_new_at timestamptz, p_old_at timestamptz
)
returns boolean
language sql
immutable
as $$
  select case
    when p_old = p_new then false
    when p_old = 'pending' then p_new in ('overdue', 'confirmed', 'refunded', 'chargeback', 'deleted')
    when p_old = 'overdue' then p_new in ('confirmed', 'refunded', 'chargeback', 'deleted')
      or (p_new = 'pending' and p_new_at is not null and p_new_at > p_old_at)
    when p_old = 'confirmed' then p_new in ('refunded', 'chargeback', 'deleted')
    when p_old = 'chargeback' then p_new = 'refunded'
      or (p_new = 'confirmed' and p_new_at is not null and p_new_at > p_old_at)
    when p_old = 'deleted' then p_new = 'pending' and p_new_at is not null and p_new_at > p_old_at
    else false
  end;
$$;

revoke all on function public._billing_payment_may_transition(text, text, timestamptz, timestamptz)
  from public, anon, authenticated;

-- Status de cobranca do Asaas (campo `status` da API) -> estado interno.
-- null = ainda sem efeito (por exemplo, estorno apenas solicitado).
create or replace function public._billing_map_asaas_payment_status(p_status text, p_deleted boolean)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_deleted, false) then 'deleted'
    when p_status in ('PENDING', 'AWAITING_RISK_ANALYSIS') then 'pending'
    when p_status in ('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED') then 'confirmed'
    when p_status in ('OVERDUE', 'DUNNING_REQUESTED') then 'overdue'
    when p_status = 'REFUNDED' then 'refunded'
    when p_status in ('CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL') then 'chargeback'
    else null
  end;
$$;

revoke all on function public._billing_map_asaas_payment_status(text, boolean) from public, anon, authenticated;

-- ============================================================
-- 7. Núcleo de eventos (não executável por API): aplica UM evento já
--    autenticado e normalizado. Devolve o resultado como texto.
--    p_authoritative = true só na reconciliação com a API do provedor (a
--    leitura é a verdade naquele instante), que ignora a tabela de transições.
-- ============================================================
create or replace function public._billing_apply_core(
  p_provider text,
  p_occurred_at timestamptz,
  p_subscription_ref text,
  p_customer_ref text,
  p_payment_ref text,
  p_payment_status text,
  p_amount numeric,
  p_due_date date,
  p_paid_at timestamptz,
  p_external_ref text,
  p_cancel boolean,
  p_authoritative boolean default false
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.billing_subscriptions;
  pay public.billing_payments;
begin
  select * into s
  from public.billing_subscriptions b
  where b.provider = p_provider and b.provider_subscription_id = p_subscription_ref
  for update;
  if not found then
    return 'unmatched';
  end if;

  -- O evento tem de pertencer a esta assinatura: referência do nosso sistema
  -- (quando o provedor a envia) e cliente do provedor precisam bater.
  if p_external_ref is not null and p_external_ref <> s.id::text then
    return 'reference_mismatch';
  end if;
  if p_customer_ref is distinct from s.provider_customer_id then
    return 'customer_mismatch';
  end if;

  if p_cancel then
    if s.status = 'cancelled' then
      return 'already_cancelled';
    end if;
    update public.billing_subscriptions set status = 'cancelled', cancelled_at = now() where id = s.id;
    perform public._billing_recompute(s.id);
    return 'cancelled';
  end if;

  if p_payment_ref is null or p_payment_status is null then
    return 'ignored';
  end if;

  -- Confirmar pagamento exige valor igual ou maior que o fixado no plano.
  if p_payment_status = 'confirmed' and (p_amount is null or round(p_amount, 2) < s.amount) then
    return 'value_mismatch';
  end if;

  select * into pay
  from public.billing_payments p
  where p.provider = p_provider and p.provider_payment_id = p_payment_ref
  for update;

  if not found then
    insert into public.billing_payments
      (subscription_id, provider, provider_payment_id, amount, status, due_date, paid_at, last_event_at)
    values
      (s.id, p_provider, p_payment_ref, coalesce(round(p_amount, 2), s.amount), p_payment_status,
       p_due_date, p_paid_at, coalesce(p_occurred_at, now()));
  else
    if pay.subscription_id <> s.id then
      return 'payment_mismatch';
    end if;
    if pay.status = p_payment_status then
      return 'noop';
    end if;
    if not p_authoritative
       and not public._billing_payment_may_transition(pay.status, p_payment_status, p_occurred_at, pay.last_event_at) then
      return 'stale';
    end if;
    update public.billing_payments
    set status = p_payment_status,
        due_date = coalesce(p_due_date, due_date),
        paid_at = coalesce(p_paid_at, paid_at),
        last_event_at = greatest(last_event_at, coalesce(p_occurred_at, now()))
    where id = pay.id;
  end if;

  perform public._billing_recompute(s.id);
  return 'applied';
end;
$$;

revoke all on function public._billing_apply_core(text, timestamptz, text, text, text, text, numeric, date, timestamptz, text, boolean, boolean)
  from public, anon, authenticated;

-- Fecha o registro do evento: guarda resultado e o status resultante da
-- assinatura (a métrica de churn lê payload->>'new_status').
create or replace function public._billing_ledger_finish(
  p_event_row uuid,
  p_provider text,
  p_subscription_ref text,
  p_result text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_activated timestamptz;
  v_new_status text;
begin
  select b.status, b.activated_at into v_status, v_activated
  from public.billing_subscriptions b
  where b.provider = p_provider and b.provider_subscription_id = p_subscription_ref;

  v_new_status := case
    when p_result = 'cancelled' and v_activated is null then 'withdrawn'
    else v_status
  end;

  update public.asaas_webhook_events
  set result = p_result,
      payload = payload || jsonb_build_object('new_status', v_new_status)
  where id = p_event_row;
end;
$$;

revoke all on function public._billing_ledger_finish(uuid, text, text, text) from public, anon, authenticated;

-- ============================================================
-- 8. Abertura da assinatura (OWNER). Valor, moeda, plano e restaurante saem do
--    BANCO; o chamador só escolhe o plano. Idempotente: repetir devolve a
--    mesma tentativa em andamento.
-- ============================================================
create or replace function public.billing_begin_subscription(p_plan_id uuid, p_provider text default 'asaas')
returns table (out_subscription_id uuid, out_amount numeric, out_currency text, out_plan_name text, out_provider text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid;
  v_role text;
  v_plan_name text;
  v_price numeric;
  v_sub public.billing_subscriptions;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select rm.restaurant_id, rm.role into v_restaurant_id, v_role
  from public.restaurant_members rm
  where rm.user_id = auth.uid()
  limit 1;

  if v_restaurant_id is null or v_role <> 'OWNER' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_provider is distinct from 'asaas' then
    raise exception 'invalid_provider' using errcode = '22023';
  end if;

  select pl.name, pl.price into v_plan_name, v_price
  from public.plans pl
  where pl.id = p_plan_id and pl.is_active = true;
  if not found then
    raise exception 'plan_not_found' using errcode = '22023';
  end if;
  if v_price is null or v_price <= 0 then
    raise exception 'plan_not_billable' using errcode = '22023';
  end if;

  -- Serializa tentativas concorrentes do mesmo restaurante.
  perform 1 from public.restaurants r where r.id = v_restaurant_id for update;

  if exists (
    select 1 from public.billing_subscriptions b
    where b.restaurant_id = v_restaurant_id and b.status in ('pending', 'active', 'overdue')
  ) then
    raise exception 'already_subscribed' using errcode = '55000';
  end if;

  select * into v_sub
  from public.billing_subscriptions b
  where b.restaurant_id = v_restaurant_id and b.status = 'initiated'
  for update;

  if found then
    update public.billing_subscriptions
    set plan_id = p_plan_id, amount = v_price, provider = p_provider
    where id = v_sub.id
    returning * into v_sub;
  else
    insert into public.billing_subscriptions (restaurant_id, plan_id, provider, amount, currency, status)
    values (v_restaurant_id, p_plan_id, p_provider, v_price, 'BRL', 'initiated')
    returning * into v_sub;
  end if;

  return query select v_sub.id, v_sub.amount, v_sub.currency, v_plan_name, v_sub.provider;
end;
$$;

revoke all on function public.billing_begin_subscription(uuid, text) from public, anon;
grant execute on function public.billing_begin_subscription(uuid, text) to authenticated;

-- ============================================================
-- 9. Registro dos IDs do provedor — SÓ O BACKEND (service_role). O servidor
--    leu a assinatura na API autenticada do provedor e conferiu cliente,
--    valor e referência antes de chamar; o valor conferido vem em
--    p_verified_amount e o banco exige que bata com o fixado no plano. Valida
--    formato e unicidade, leva a assinatura a 'pending' e NÃO libera acesso.
--    Reaplica eventos que chegaram antes do registro (corrida webhook × registro).
-- ============================================================
create or replace function public.billing_attach_provider_subscription(
  p_subscription_id uuid,
  p_provider_customer_id text,
  p_provider_subscription_id text,
  p_verified_amount numeric
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.billing_subscriptions;
  ev record;
  v_result text;
begin
  select * into s from public.billing_subscriptions b where b.id = p_subscription_id for update;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0002';
  end if;
  if s.status <> 'initiated' then
    raise exception 'invalid_state' using errcode = '55000';
  end if;

  if p_verified_amount is null or round(p_verified_amount, 2) <> s.amount then
    raise exception 'amount_mismatch' using errcode = '22023';
  end if;

  if s.provider = 'asaas' and (
       p_provider_customer_id is null or p_provider_customer_id !~ '^cus_[A-Za-z0-9]{6,64}$'
    or p_provider_subscription_id is null or p_provider_subscription_id !~ '^sub_[A-Za-z0-9]{6,64}$'
  ) then
    raise exception 'invalid_provider_reference' using errcode = '22023';
  end if;

  begin
    update public.billing_subscriptions
    set provider_customer_id = p_provider_customer_id,
        provider_subscription_id = p_provider_subscription_id,
        status = 'pending'
    where id = s.id;
  exception when unique_violation then
    raise exception 'provider_reference_in_use' using errcode = '23505';
  end;

  perform public._billing_sync_restaurant(s.restaurant_id);

  -- Eventos recebidos antes deste registro (já autenticados pelo token).
  for ev in
    select e.id, e.payload
    from public.asaas_webhook_events e
    where e.provider = s.provider
      and e.result = 'unmatched'
      and e.payload ->> 'asaas_subscription_id' = p_provider_subscription_id
    order by coalesce(e.occurred_at, e.processed_at), e.processed_at
  loop
    v_result := public._billing_apply_core(
      s.provider,
      nullif(ev.payload ->> 'occurred_at', '')::timestamptz,
      p_provider_subscription_id,
      ev.payload ->> 'customer',
      ev.payload ->> 'payment_id',
      ev.payload ->> 'payment_status',
      nullif(ev.payload ->> 'amount', '')::numeric,
      nullif(ev.payload ->> 'due_date', '')::date,
      nullif(ev.payload ->> 'paid_at', '')::timestamptz,
      ev.payload ->> 'external_reference',
      coalesce((ev.payload ->> 'cancel')::boolean, false)
    );
    perform public._billing_ledger_finish(ev.id, s.provider, p_provider_subscription_id, v_result);
  end loop;
end;
$$;

revoke all on function public.billing_attach_provider_subscription(uuid, text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.billing_attach_provider_subscription(uuid, text, text, numeric) to service_role;

-- ============================================================
-- 10. Webhook do Asaas. Autenticado por token (única credencial do chamador
--     anônimo), comparado por digest SHA-256; o mapeamento evento -> efeito é
--     feito AQUI, nunca no cliente. Idempotente por (provider, event id).
--     Nunca levanta erro por evento desconhecido ou inconsistente (responde
--     com o resultado) para o Asaas não reenviar nem pausar a fila; só levanta
--     not_authorized/invalid_event.
-- ============================================================
create or replace function public.billing_webhook_token_valid(p_webhook_token text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_stored_token text;
begin
  select asaas_webhook_token into v_stored_token from public.billing_settings where id = true;
  if v_stored_token is null or p_webhook_token is null or length(p_webhook_token) > 512 then
    return false;
  end if;
  return sha256(convert_to(p_webhook_token, 'UTF8')) = sha256(convert_to(v_stored_token, 'UTF8'));
end;
$$;

revoke all on function public.billing_webhook_token_valid(text) from public, authenticated;
grant execute on function public.billing_webhook_token_valid(text) to anon;

create or replace function public.process_asaas_webhook(
  p_webhook_token text,
  p_event_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_subscription_id text,
  p_customer_id text,
  p_payment_id text,
  p_value numeric,
  p_due_date date,
  p_paid_at timestamptz,
  p_external_reference text
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row uuid;
  v_payment_status text;
  v_cancel boolean := false;
  v_result text;
begin
  if not public.billing_webhook_token_valid(p_webhook_token) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_event_id is null or length(trim(p_event_id)) = 0 or length(p_event_id) > 200
     or p_event_type is null or length(trim(p_event_type)) = 0 or length(p_event_type) > 100 then
    raise exception 'invalid_event' using errcode = '22023';
  end if;

  insert into public.asaas_webhook_events (provider, asaas_event_id, event_type, occurred_at, payload)
  values ('asaas', p_event_id, p_event_type, p_occurred_at, jsonb_build_object(
    'asaas_subscription_id', p_subscription_id,
    'new_status', null,
    'occurred_at', p_occurred_at,
    'customer', p_customer_id,
    'payment_id', p_payment_id,
    'amount', p_value,
    'due_date', p_due_date,
    'paid_at', p_paid_at,
    'external_reference', p_external_reference
  ))
  on conflict (provider, asaas_event_id) do nothing
  returning id into v_row;

  -- Evento repetido: o efeito já foi aplicado (ou descartado) na primeira vez.
  if v_row is null then
    return 'duplicate';
  end if;

  v_payment_status := case p_event_type
    when 'PAYMENT_CREATED' then 'pending'
    when 'PAYMENT_RESTORED' then 'pending'
    when 'PAYMENT_CONFIRMED' then 'confirmed'
    when 'PAYMENT_RECEIVED' then 'confirmed'
    when 'PAYMENT_OVERDUE' then 'overdue'
    when 'PAYMENT_REFUNDED' then 'refunded'
    when 'PAYMENT_CHARGEBACK_REQUESTED' then 'chargeback'
    when 'PAYMENT_DELETED' then 'deleted'
    else null
  end;
  if p_event_type in ('SUBSCRIPTION_DELETED', 'SUBSCRIPTION_INACTIVATED') then
    v_cancel := true;
  end if;

  if (v_payment_status is null and not v_cancel)
     or p_subscription_id is null or length(trim(p_subscription_id)) = 0 then
    update public.asaas_webhook_events set result = 'ignored' where id = v_row;
    return 'ignored';
  end if;

  update public.asaas_webhook_events
  set payload = payload || jsonb_build_object('payment_status', v_payment_status, 'cancel', v_cancel)
  where id = v_row;

  v_result := public._billing_apply_core(
    'asaas', p_occurred_at, p_subscription_id, p_customer_id, p_payment_id,
    v_payment_status, p_value, p_due_date, p_paid_at, p_external_reference, v_cancel
  );

  perform public._billing_ledger_finish(v_row, 'asaas', p_subscription_id, v_result);
  return v_result;
end;
$$;

revoke all on function public.process_asaas_webhook(text, text, text, timestamptz, text, text, text, numeric, date, timestamptz, text)
  from public, authenticated;
grant execute on function public.process_asaas_webhook(text, text, text, timestamptz, text, text, text, numeric, date, timestamptz, text)
  to anon;

-- ============================================================
-- 11. Reconciliação com a API do provedor — SÓ O BACKEND (service_role).
--     Recupera webhooks não entregues (e corrige confirmações indevidas): a
--     leitura da API autenticada é a verdade naquele instante.
-- ============================================================
create or replace function public.billing_list_reconcilable(p_limit integer default 100)
returns table (
  out_subscription_id uuid,
  out_provider text,
  out_subscription_ref text,
  out_customer_ref text,
  out_status text,
  out_amount numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select b.id, b.provider, b.provider_subscription_id, b.provider_customer_id, b.status, b.amount
  from public.billing_subscriptions b
  where b.status in ('pending', 'active', 'overdue')
     or (b.status = 'cancelled' and b.cancelled_at > now() - interval '60 days')
  order by b.last_reconciled_at nulls first, b.created_at
  limit greatest(1, least(coalesce(p_limit, 100), 200));
$$;

revoke all on function public.billing_list_reconcilable(integer) from public, anon, authenticated;
grant execute on function public.billing_list_reconcilable(integer) to service_role;

create or replace function public.billing_reconcile_payment(
  p_provider text,
  p_subscription_ref text,
  p_customer_ref text,
  p_payment_ref text,
  p_remote_status text,
  p_remote_deleted boolean,
  p_value numeric,
  p_due_date date,
  p_paid_at timestamptz,
  p_observed_at timestamptz default null
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text := public._billing_map_asaas_payment_status(p_remote_status, p_remote_deleted);
begin
  if p_provider is distinct from 'asaas' then
    raise exception 'invalid_provider' using errcode = '22023';
  end if;
  if v_status is null then
    return 'ignored';
  end if;
  return public._billing_apply_core(
    p_provider, coalesce(p_observed_at, now()), p_subscription_ref, p_customer_ref, p_payment_ref,
    v_status, p_value, p_due_date, p_paid_at, null, false, true
  );
end;
$$;

revoke all on function public.billing_reconcile_payment(text, text, text, text, text, boolean, numeric, date, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.billing_reconcile_payment(text, text, text, text, text, boolean, numeric, date, timestamptz, timestamptz)
  to service_role;

create or replace function public.billing_reconcile_subscription(
  p_provider text,
  p_subscription_ref text,
  p_customer_ref text,
  p_remote_status text,
  p_remote_deleted boolean
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result text := 'active_remote';
begin
  if p_provider is distinct from 'asaas' then
    raise exception 'invalid_provider' using errcode = '22023';
  end if;
  if coalesce(p_remote_deleted, false) or p_remote_status in ('INACTIVE', 'EXPIRED') then
    v_result := public._billing_apply_core(
      p_provider, now(), p_subscription_ref, p_customer_ref, null, null, null, null, null, null, true, true
    );
  end if;
  update public.billing_subscriptions
  set last_reconciled_at = now()
  where provider = p_provider and provider_subscription_id = p_subscription_ref;
  return v_result;
end;
$$;

revoke all on function public.billing_reconcile_subscription(text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.billing_reconcile_subscription(text, text, text, text, boolean) to service_role;

-- ============================================================
-- 12. Bloqueio administrativo (Master): fraude ou decisão administrativa corta
--     o acesso na hora, inclusive dentro do período já pago.
-- ============================================================
create or replace function public.master_set_billing_block(
  p_restaurant_id uuid,
  p_blocked boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.billing_subscriptions;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into s from public._billing_current_subscription(p_restaurant_id);
  if s.id is null then
    raise exception 'no_subscription' using errcode = 'P0002';
  end if;

  if coalesce(p_blocked, false) then
    if v_reason is null or length(v_reason) > 300 then
      raise exception 'reason_required' using errcode = '22023';
    end if;
    update public.billing_subscriptions
    set admin_blocked_at = now(), admin_blocked_by = auth.uid(), admin_block_reason = v_reason
    where id = s.id;
  else
    update public.billing_subscriptions
    set admin_blocked_at = null, admin_blocked_by = null, admin_block_reason = null
    where id = s.id;
  end if;
end;
$$;

revoke all on function public.master_set_billing_block(uuid, boolean, text) from public, anon;
grant execute on function public.master_set_billing_block(uuid, boolean, text) to authenticated;

-- ============================================================
-- 13. Estado de acesso: assinatura 'pending' ou ainda sem cobrança confirmada
--     NÃO libera acesso — a loja segue regida por teste gratuito/cortesia.
--     Só assinatura 'active' (cobrança confirmada) libera. Assinatura cancelada
--     mantém o acesso até o fim do período JÁ PAGO. Bloqueio administrativo
--     vence tudo. Sem nenhum registro em billing_subscriptions, o espelho em
--     restaurants só pode BLOQUEAR (overdue/cancelled herdados), nunca liberar.
-- ============================================================
create or replace function public._restaurant_access_state(p_restaurant_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_mirror_status text;
  s public.billing_subscriptions;
begin
  select r.subscription_status into v_mirror_status
  from public.restaurants r
  where r.id = p_restaurant_id;

  if not found then
    return null;
  end if;

  select * into s from public._billing_current_subscription(p_restaurant_id);

  if s.id is not null then
    if s.admin_blocked_at is not null then
      return 'blocked';
    end if;
    if s.status = 'overdue' then
      return 'overdue';
    end if;
    if s.status = 'cancelled' and s.activated_at is not null then
      if s.current_period_end is not null and s.current_period_end > now() then
        return null;
      end if;
      return 'cancelled';
    end if;
    if s.status = 'active' then
      return null;
    end if;
  else
    if v_mirror_status = 'overdue' then
      return 'overdue';
    end if;
    if v_mirror_status = 'cancelled' then
      return 'cancelled';
    end if;
  end if;

  if exists (
    select 1
    from public.restaurant_members rm
    join public.profiles p on p.user_id = rm.user_id
    where rm.restaurant_id = p_restaurant_id and rm.role = 'OWNER' and p.is_master
  ) then
    return null;
  end if;

  if exists (
    select 1
    from public.restaurant_members rm
    join public.profiles p on p.user_id = rm.user_id
    where rm.restaurant_id = p_restaurant_id
      and rm.role = 'OWNER'
      and p.trial_ends_at is not null
      and p.trial_ends_at > now()
  ) then
    return null;
  end if;

  return 'trial_expired';
end;
$$;

revoke all on function public._restaurant_access_state(uuid) from public, anon, authenticated;

-- ============================================================
-- 14. "Tem plano" para fins de cortesia de trial: assinatura apenas 'pending'
--     (nada pago) não conta, porque nesse caso o teste gratuito ainda governa
--     o acesso. Sem registro em billing_subscriptions vale o espelho antigo.
-- ============================================================
create or replace function public._billing_has_paid_plan(p_restaurant_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  s public.billing_subscriptions;
begin
  select * into s from public._billing_current_subscription(p_restaurant_id);
  if s.id is null then
    return exists (select 1 from public.restaurants r where r.id = p_restaurant_id and r.plan_id is not null);
  end if;
  return s.status in ('active', 'overdue') or (s.status = 'cancelled' and s.activated_at is not null);
end;
$$;

revoke all on function public._billing_has_paid_plan(uuid) from public, anon, authenticated;

do $patch_trial$
declare
  v_def text;
  v_old constant text := $old$if v_plan_id is not null then$old$;
  v_new constant text := $new$if public._billing_has_paid_plan(p_restaurant_id) then$new$;
  v_occurrences integer;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'master_extend_trial';

  v_occurrences := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'master_extend_trial: esperava 1 ocorrencia da checagem de plano, achei %', v_occurrences;
  end if;

  execute replace(v_def, v_old, v_new);
end;
$patch_trial$;

-- ============================================================
-- 15. Métrica "convertidos do teste": 'pending' não é conversão (nada foi
--     pago). Patch pontual sobre a definição vigente; falha alto se a linha
--     esperada não aparecer exatamente uma vez.
-- ============================================================
do $patch$
declare
  v_def text;
  v_old constant text := $old$and r.subscription_status in ('active', 'pending')$old$;
  v_new constant text := $new$and r.subscription_status = 'active'$new$;
  v_occurrences integer;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'master_metrics';

  v_occurrences := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'master_metrics: esperava 1 ocorrencia do filtro de conversao, achei %', v_occurrences;
  end if;

  execute replace(v_def, v_old, v_new);
end;
$patch$;
