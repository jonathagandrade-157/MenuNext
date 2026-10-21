-- MenuNext — Mercado Pago como segundo provedor da assinatura do lojista
-- (a P1-01 já guarda o provedor em cada assinatura, cobrança e evento, e o
-- núcleo _billing_apply_core é genérico; aqui só se estendem as bordas).
--
-- DEPENDE de 20261009010000_secure_subscription_billing.sql (P1-01): aplicar
-- DEPOIS dela. Não altera nenhum dado existente: o provedor ativo continua
-- 'asaas' até o Master trocá-lo, e trocar o provedor NÃO reescreve o histórico
-- (cada assinatura guarda o seu).
--
-- MODELO DO MERCADO PAGO
-- * Não há objeto "cliente" antes do pagador autorizar a assinatura. A ligação
--   é pelo id da assinatura (preapproval) + external_reference (= id da
--   assinatura do MenuNext), ambos conferidos pelo backend na API autenticada.
--   Por isso, para este provedor, "provider_customer_id" guarda o próprio id da
--   assinatura do MenuNext (ref. externa) e é conferido por igualdade.
-- * A autenticidade do webhook é verificada no BACKEND (HMAC-SHA256 do
--   x-signature, segredo em variável de ambiente); a função de processamento
--   abaixo só é executável por service_role e NUNCA pelo anon.
-- * Quem decide o efeito de um evento continua sendo o banco: o status
--   combinado "fatura/pagamento" é mapeado AQUI, não no cliente.
-- * O provedor usado em novas assinaturas é escolhido pelo Master
--   (billing_settings.subscription_provider) e imposto pelo banco: o lojista
--   não consegue escolher outro chamando a RPC diretamente.

-- ============================================================
-- 1. Provedores aceitos
-- ============================================================
do $$
declare
  v_name text;
begin
  select c.conname into v_name
  from pg_constraint c
  where c.conrelid = 'public.billing_subscriptions'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like 'CHECK ((provider = %';
  if v_name is null then
    raise exception 'billing_mercadopago: constraint de provedor da P1-01 nao encontrada (aplicar a P1-01 antes)';
  end if;
  execute format('alter table public.billing_subscriptions drop constraint %I', v_name);
end;
$$;

alter table public.billing_subscriptions
  add constraint billing_subscriptions_provider_check check (provider in ('asaas', 'mercadopago'));

-- ============================================================
-- 2. Provedor ativo para NOVAS assinaturas (escolhido pelo Master).
--    billing_settings continua sem policy: só funções SECURITY DEFINER a tocam.
-- ============================================================
alter table public.billing_settings
  add column subscription_provider text not null default 'asaas'
    check (subscription_provider in ('asaas', 'mercadopago'));

create or replace function public.billing_subscription_provider()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.subscription_provider from public.billing_settings s where s.id = true;
$$;

revoke all on function public.billing_subscription_provider() from public, anon;
grant execute on function public.billing_subscription_provider() to authenticated, service_role;

create or replace function public.master_set_subscription_provider(p_provider text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_provider is null or p_provider not in ('asaas', 'mercadopago') then
    raise exception 'invalid_provider' using errcode = '22023';
  end if;
  update public.billing_settings set subscription_provider = p_provider where id = true;
  return p_provider;
end;
$$;

revoke all on function public.master_set_subscription_provider(text) from public, anon;
grant execute on function public.master_set_subscription_provider(text) to authenticated;

-- ============================================================
-- 3. Status de cobrança do Mercado Pago -> estado interno.
--    Entrada combinada "<status da fatura>/<status do pagamento>", por
--    exemplo 'processed/approved' ou 'scheduled/'. null = sem efeito ainda.
--    Só é CONFIRMADA com fatura processada E pagamento aprovado.
-- ============================================================
create or replace function public._billing_map_mp_payment_status(p_status text, p_deleted boolean)
returns text
language plpgsql
immutable
as $$
declare
  v_invoice text := split_part(coalesce(p_status, ''), '/', 1);
  v_payment text := nullif(split_part(coalesce(p_status, ''), '/', 2), '');
begin
  return case
    when coalesce(p_deleted, false) then 'deleted'
    when v_payment = 'charged_back' then 'chargeback'
    when v_payment = 'refunded' then 'refunded'
    when v_invoice = 'cancelled' or v_payment = 'cancelled' then 'deleted'
    when v_invoice = 'processed' and v_payment = 'approved' then 'confirmed'
    when v_payment = 'rejected' or v_invoice = 'recycling' then 'overdue'
    when v_invoice in ('scheduled', 'processed')
         and (v_payment is null or v_payment in ('pending', 'in_process', 'authorized')) then 'pending'
    else null
  end;
end;
$$;

revoke all on function public._billing_map_mp_payment_status(text, boolean) from public, anon, authenticated;

-- ============================================================
-- 4. Abertura da assinatura: o provedor é SEMPRE o escolhido pelo Master.
--    p_provider nulo (padrão) = usa o escolhido; informado = tem de ser igual
--    ao escolhido. O servidor descobre o provedor pelo out_provider devolvido.
--    O padrão passa de 'asaas' para nulo: é preciso recriar a função (o
--    Postgres não permite remover/alterar o padrão com CREATE OR REPLACE).
-- ============================================================
drop function if exists public.billing_begin_subscription(uuid, text);

create function public.billing_begin_subscription(p_plan_id uuid, p_provider text default null)
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
  v_selected text;
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

  select s.subscription_provider into v_selected from public.billing_settings s where s.id = true;
  if p_provider is not null and p_provider is distinct from v_selected then
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
    set plan_id = p_plan_id, amount = v_price, provider = v_selected
    where id = v_sub.id
    returning * into v_sub;
  else
    insert into public.billing_subscriptions (restaurant_id, plan_id, provider, amount, currency, status)
    values (v_restaurant_id, p_plan_id, v_selected, v_price, 'BRL', 'initiated')
    returning * into v_sub;
  end if;

  return query select v_sub.id, v_sub.amount, v_sub.currency, v_plan_name, v_sub.provider;
end;
$$;

revoke all on function public.billing_begin_subscription(uuid, text) from public, anon;
grant execute on function public.billing_begin_subscription(uuid, text) to authenticated;

-- ============================================================
-- 5. Registro dos ids do provedor (só backend): formato por provedor.
--    Mercado Pago: id da assinatura alfanumérico e "cliente" = id da
--    assinatura do MenuNext (ver cabeçalho).
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

  if s.provider = 'mercadopago' and (
       p_provider_customer_id is distinct from s.id::text
    or p_provider_subscription_id is null or p_provider_subscription_id !~ '^[A-Za-z0-9]{10,64}$'
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

  -- Eventos recebidos antes deste registro (já autenticados).
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
-- 5b. Assinatura PENDENTE do próprio OWNER (para retomar o pagamento: quem
--     fecha a aba do Mercado Pago antes de pagar precisa do link de novo).
--     Só devolve a do restaurante do chamador e só para o OWNER; o link em si
--     é lido pelo servidor na API autenticada do provedor.
-- ============================================================
create or replace function public.billing_pending_subscription()
returns table (out_subscription_id uuid, out_provider text, out_subscription_ref text, out_amount numeric)
language sql
stable
security definer
set search_path to 'public'
as $$
  select b.id, b.provider, b.provider_subscription_id, b.amount
  from public.restaurant_members rm
  join public.billing_subscriptions b on b.restaurant_id = rm.restaurant_id
  where rm.user_id = auth.uid() and rm.role = 'OWNER' and b.status = 'pending'
  limit 1;
$$;

revoke all on function public.billing_pending_subscription() from public, anon;
grant execute on function public.billing_pending_subscription() to authenticated;

-- ============================================================
-- 6. Evento do Mercado Pago. SÓ service_role: o backend já verificou a
--    assinatura HMAC do webhook e releu o recurso na API autenticada. O
--    mapeamento evento -> efeito é feito AQUI. Idempotente por
--    (provider, event id); não levanta erro por evento desconhecido ou
--    inconsistente (devolve o resultado), só invalid_event.
-- ============================================================
create or replace function public.process_mercadopago_event(
  p_event_id text,
  p_event_kind text,
  p_occurred_at timestamptz,
  p_subscription_ref text,
  p_customer_ref text,
  p_external_ref text,
  p_subscription_status text,
  p_payment_ref text,
  p_payment_status text,
  p_amount numeric,
  p_due_date date,
  p_paid_at timestamptz
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
  if p_event_id is null or length(trim(p_event_id)) = 0 or length(p_event_id) > 200
     or p_event_kind is null or p_event_kind not in ('preapproval', 'authorized_payment') then
    raise exception 'invalid_event' using errcode = '22023';
  end if;

  insert into public.asaas_webhook_events (provider, asaas_event_id, event_type, occurred_at, payload)
  values ('mercadopago', p_event_id, p_event_kind, p_occurred_at, jsonb_build_object(
    'asaas_subscription_id', p_subscription_ref,
    'new_status', null,
    'occurred_at', p_occurred_at,
    'customer', p_customer_ref,
    'payment_id', p_payment_ref,
    'amount', p_amount,
    'due_date', p_due_date,
    'paid_at', p_paid_at,
    'external_reference', p_external_ref
  ))
  on conflict (provider, asaas_event_id) do nothing
  returning id into v_row;

  if v_row is null then
    return 'duplicate';
  end if;

  if p_event_kind = 'authorized_payment' and p_payment_ref is not null then
    v_payment_status := public._billing_map_mp_payment_status(p_payment_status, false);
  end if;
  if p_event_kind = 'preapproval' and p_subscription_status = 'cancelled' then
    v_cancel := true;
  end if;

  if (v_payment_status is null and not v_cancel)
     or p_subscription_ref is null or length(trim(p_subscription_ref)) = 0 then
    update public.asaas_webhook_events set result = 'ignored' where id = v_row;
    return 'ignored';
  end if;

  update public.asaas_webhook_events
  set payload = payload || jsonb_build_object('payment_status', v_payment_status, 'cancel', v_cancel)
  where id = v_row;

  v_result := public._billing_apply_core(
    'mercadopago', p_occurred_at, p_subscription_ref, p_customer_ref, p_payment_ref,
    v_payment_status, p_amount, p_due_date, p_paid_at, p_external_ref, v_cancel
  );

  perform public._billing_ledger_finish(v_row, 'mercadopago', p_subscription_ref, v_result);
  return v_result;
end;
$$;

revoke all on function public.process_mercadopago_event(text, text, timestamptz, text, text, text, text, text, text, numeric, date, timestamptz)
  from public, anon, authenticated;
grant execute on function public.process_mercadopago_event(text, text, timestamptz, text, text, text, text, text, text, numeric, date, timestamptz)
  to service_role;

-- ============================================================
-- 7. Reconciliação: aceita os dois provedores (mesmas assinaturas da P1-01).
--    Asaas: status cru do Asaas. Mercado Pago: status combinado
--    "<fatura>/<pagamento>" (ver mapeamento acima).
-- ============================================================
-- Lista para reconciliar, com filtro opcional por provedor: o cron só pede os provedores
-- configurados, para as assinaturas de um provedor SEM credenciais (que nunca são
-- reconciliadas) não ocuparem o lote e não deixarem as demais sem leitura. O padrão
-- (nulo) lista todos, como antes. Recriada porque o Postgres não permite acrescentar
-- parâmetro com CREATE OR REPLACE (e dois formatos ficariam ambíguos).
drop function if exists public.billing_list_reconcilable(integer);

create function public.billing_list_reconcilable(p_limit integer default 100, p_providers text[] default null)
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
  where (b.status in ('pending', 'active', 'overdue')
         or (b.status = 'cancelled' and b.cancelled_at > now() - interval '60 days'))
    and (p_providers is null or b.provider = any (p_providers))
  order by b.last_reconciled_at nulls first, b.created_at
  limit greatest(1, least(coalesce(p_limit, 100), 200));
$$;

revoke all on function public.billing_list_reconcilable(integer, text[]) from public, anon, authenticated;
grant execute on function public.billing_list_reconcilable(integer, text[]) to service_role;

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
  v_status text;
begin
  if p_provider = 'asaas' then
    v_status := public._billing_map_asaas_payment_status(p_remote_status, p_remote_deleted);
  elsif p_provider = 'mercadopago' then
    v_status := public._billing_map_mp_payment_status(p_remote_status, p_remote_deleted);
  else
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
  v_cancel boolean;
begin
  if p_provider = 'asaas' then
    v_cancel := coalesce(p_remote_deleted, false) or p_remote_status in ('INACTIVE', 'EXPIRED');
  elsif p_provider = 'mercadopago' then
    v_cancel := coalesce(p_remote_deleted, false) or p_remote_status = 'cancelled';
  else
    raise exception 'invalid_provider' using errcode = '22023';
  end if;

  if v_cancel then
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
-- 8. Verificação final: falha a migration inteira (transação única) se algo
--    esperado não existir ou se o acesso estiver mais aberto do que deveria.
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.billing_subscriptions'::regclass
      and pg_get_constraintdef(oid) ilike '%mercadopago%'
  ) then
    raise exception 'billing_mercadopago: constraint de provedor nao criada';
  end if;
  if has_function_privilege('anon', 'public.process_mercadopago_event(text, text, timestamptz, text, text, text, text, text, text, numeric, date, timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.process_mercadopago_event(text, text, timestamptz, text, text, text, text, text, text, numeric, date, timestamptz)', 'execute') then
    raise exception 'billing_mercadopago: process_mercadopago_event nao pode ser executavel por anon/authenticated';
  end if;
  if has_function_privilege('anon', 'public.billing_pending_subscription()', 'execute') then
    raise exception 'billing_mercadopago: billing_pending_subscription nao pode ser executavel por anon';
  end if;
  if has_function_privilege('anon', 'public.billing_subscription_provider()', 'execute') then
    raise exception 'billing_mercadopago: billing_subscription_provider nao pode ser executavel por anon';
  end if;
  if has_function_privilege('anon', 'public.master_set_subscription_provider(text)', 'execute') then
    raise exception 'billing_mercadopago: master_set_subscription_provider nao pode ser executavel por anon';
  end if;
end;
$$;
