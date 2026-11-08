-- MenuNext — Pix com confirmação automática (v1, Mercado Pago da PRÓPRIA loja). DESLIGADO por padrão.
--
-- Nunca aplicada em produção por este repositório; validada em PostgreSQL sintético (supabase/tests/pix_automatico.sql).
--
-- MODELO
--   * O dinheiro vai direto para a conta Mercado Pago da loja: o MenuNext nunca recebe nem repassa valores.
--   * O OWNER cola o Access Token da conta dele no painel. O SERVIDOR confere o token na API (/users/me), cifra
--     (AES-256-GCM, chave PAYMENTS_ENCRYPTION_KEY que nunca entra no banco) e grava só o texto cifrado, os 4
--     últimos caracteres e o id da conta recebedora (collector_id). Opcional: a "assinatura secreta" de webhooks
--     da aplicação da loja, também cifrada, para validar o cabeçalho x-signature dos avisos.
--   * Pedido Pix numa loja com o recurso ligado: o backend reserva a cobrança (status 'creating'), cria no
--     Mercado Pago com o total do banco e idempotência pelo pedido, e só então mostra o QR ('pending').
--     Resposta indefinida (rede, 5xx) mantém 'creating' e é tentada de novo com a MESMA chave de idempotência —
--     nunca cai na chave Pix comum enquanto a cobrança pode existir. Recusa definitiva vira 'failed'.
--   * Confirmação: o backend consulta o pagamento NA API do Mercado Pago (webhook e página do pedido só
--     disparam a consulta) e o banco só aprova com valor, moeda BRL, conta recebedora e referência do pedido
--     iguais. Pago é final; aprovação que chega depois de "cancelado/expirado" no nosso lado ainda vale.
--   * Sem o recurso ligado (padrão) nada muda: o Pix segue pela chave estática da loja (conferência manual).

-- ============================================================
-- 1. configuração por loja
-- ============================================================
create table public.restaurant_pix_settings (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  provider text not null default 'mercadopago' check (provider = 'mercadopago'),
  token_ciphertext text not null check (token_ciphertext ~ '^v1:[A-Za-z0-9+/=_-]+:[A-Za-z0-9+/=_-]+:[A-Za-z0-9+/=_-]+$' and char_length(token_ciphertext) <= 4000),
  token_hint text not null check (token_hint ~ '^[A-Za-z0-9_-]{1,4}$'),
  collector_id text not null check (collector_id ~ '^[0-9]{1,20}$'),
  webhook_secret_ciphertext text check (webhook_secret_ciphertext is null or (webhook_secret_ciphertext ~ '^v1:[A-Za-z0-9+/=_-]+:[A-Za-z0-9+/=_-]+:[A-Za-z0-9+/=_-]+$' and char_length(webhook_secret_ciphertext) <= 4000)),
  enabled boolean not null default false,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.restaurant_pix_settings
  for each row execute function public.set_updated_at();

alter table public.restaurant_pix_settings enable row level security;
revoke all on public.restaurant_pix_settings from public, anon, authenticated;
-- sem policies: só funções SECURITY DEFINER e o backend (service_role, que ignora RLS) tocam a tabela

-- ============================================================
-- 2. cobranças
-- ============================================================
create table public.order_pix_charges (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  provider text not null default 'mercadopago' check (provider = 'mercadopago'),
  -- conta recebedora no momento da criação: a aprovação precisa vir paga A ESTA conta
  collector_id text not null check (collector_id ~ '^[0-9]{1,20}$'),
  provider_payment_id text unique check (provider_payment_id ~ '^[0-9]{1,30}$'),
  amount numeric(10, 2) not null check (amount > 0),
  status text not null default 'creating' check (status in ('creating', 'pending', 'approved', 'cancelled', 'expired', 'failed')),
  qr_code text check (char_length(qr_code) between 20 and 1000),
  expires_at timestamptz,
  approved_at timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 20),
  last_attempt_at timestamptz,
  failure_reason text check (failure_reason is null or failure_reason ~ '^[a-z_]{1,40}$'),
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_pix_charges_approved_at check ((status = 'approved') = (approved_at is not null)),
  constraint order_pix_charges_provider_id check (status in ('creating', 'failed') or provider_payment_id is not null),
  constraint order_pix_charges_qr check (status <> 'pending' or qr_code is not null)
);

create index order_pix_charges_restaurant_idx on public.order_pix_charges (restaurant_id, created_at desc);
create index order_pix_charges_open_idx on public.order_pix_charges (created_at) where status in ('creating', 'pending');

create trigger set_updated_at before update on public.order_pix_charges
  for each row execute function public.set_updated_at();

alter table public.order_pix_charges enable row level security;
revoke all on public.order_pix_charges from public, anon, authenticated;
grant select on public.order_pix_charges to authenticated;

create policy order_pix_charges_select_members on public.order_pix_charges
  for select to authenticated using (public.is_restaurant_member(restaurant_id));

-- ============================================================
-- 3. orders.paid_at
-- ============================================================
alter table public.orders add column paid_at timestamptz;

-- ============================================================
-- 4a. OWNER: configuração (segredos chegam JÁ CIFRADOS pelo servidor; nunca são devolvidos)
-- ============================================================
create or replace function public.pix_settings_status(p_restaurant uuid)
returns table (configured boolean, enabled boolean, token_hint text, webhook_secret_configured boolean, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.is_restaurant_member(p_restaurant) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
    select true, s.enabled, s.token_hint, s.webhook_secret_ciphertext is not null, s.updated_at
      from public.restaurant_pix_settings s where s.restaurant_id = p_restaurant
    union all
    select false, false, null::text, false, null::timestamptz
     where not exists (select 1 from public.restaurant_pix_settings s where s.restaurant_id = p_restaurant);
end;
$$;

create or replace function public.pix_settings_save(p_restaurant uuid, p_ciphertext text, p_hint text, p_collector_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_restaurant_owner(p_restaurant) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  -- token novo nasce DESLIGADO: o OWNER liga depois de conferir. Trocar de conta apaga o segredo do webhook antigo.
  insert into public.restaurant_pix_settings (restaurant_id, token_ciphertext, token_hint, collector_id, enabled, updated_by)
  values (p_restaurant, p_ciphertext, p_hint, p_collector_id, false, auth.uid())
  on conflict (restaurant_id) do update
    set token_ciphertext = excluded.token_ciphertext, token_hint = excluded.token_hint, enabled = false,
        webhook_secret_ciphertext = case when restaurant_pix_settings.collector_id = excluded.collector_id
                                         then restaurant_pix_settings.webhook_secret_ciphertext end,
        collector_id = excluded.collector_id, updated_by = auth.uid();
exception
  when check_violation then
    raise exception 'invalid_token' using errcode = '22023';
end;
$$;

create or replace function public.pix_settings_save_webhook_secret(p_restaurant uuid, p_ciphertext text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_restaurant_owner(p_restaurant) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.restaurant_pix_settings set webhook_secret_ciphertext = p_ciphertext, updated_by = auth.uid()
   where restaurant_id = p_restaurant;
  if not found then
    raise exception 'not_configured' using errcode = '22023';
  end if;
exception
  when check_violation then
    raise exception 'invalid_secret' using errcode = '22023';
end;
$$;

create or replace function public.pix_settings_set_enabled(p_restaurant uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_restaurant_owner(p_restaurant) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.restaurant_pix_settings set enabled = coalesce(p_enabled, false), updated_by = auth.uid()
   where restaurant_id = p_restaurant;
  if not found then
    raise exception 'not_configured' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.pix_settings_delete(p_restaurant uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_restaurant_owner(p_restaurant) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  delete from public.restaurant_pix_settings where restaurant_id = p_restaurant;
end;
$$;

-- ============================================================
-- 4b. visitante: a cobrança do PRÓPRIO pedido (o public_id não adivinhável é a autorização, como get_public_order)
-- ============================================================
create or replace function public.get_order_pix_charge(p_slug text, p_public_id uuid)
returns table (status text, qr_code text, amount numeric, expires_at timestamptz, approved_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.status,
         case when c.status = 'pending' then c.qr_code else null end,
         c.amount, c.expires_at, c.approved_at
    from public.order_pix_charges c
    join public.orders o on o.id = c.order_id
    join public.restaurants r on r.id = o.restaurant_id
   where r.slug = p_slug and o.public_id = p_public_id;
$$;

-- ============================================================
-- 4c. backend (service_role)
-- ============================================================

-- Reserva (ou retoma) a criação da cobrança de um pedido Pix de loja LIGADA. Devolve linha só para QUEM pode
-- tentar agora: cobrança nova, ou ainda 'creating' sem tentativa nos últimos p_retry_after segundos (evita duas
-- chamadas simultâneas ao provedor). Cada tentativa soma 1 em attempts.
create or replace function public.pix_charge_begin_backend(p_slug text, p_public_id uuid, p_retry_after_seconds integer)
returns table (charge_id uuid, restaurant_id uuid, order_number integer, amount numeric, restaurant_name text,
               token_ciphertext text, collector_id text, attempts integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order record;
  v_settings record;
  v_charge record;
begin
  select o.id, o.restaurant_id, o.order_number, o.total, r.name as restaurant_name into v_order
    from public.orders o join public.restaurants r on r.id = o.restaurant_id
   where r.slug = p_slug and o.public_id = p_public_id
     and o.payment_method = 'pix' and o.status <> 'cancelled' and o.paid_at is null and o.total > 0
   for update of o;
  if v_order.id is null then return; end if;

  select * into v_charge from public.order_pix_charges c where c.order_id = v_order.id for update;
  if v_charge.id is null then
    select s.* into v_settings from public.restaurant_pix_settings s where s.restaurant_id = v_order.restaurant_id and s.enabled;
    if v_settings.restaurant_id is null then return; end if;
    insert into public.order_pix_charges (order_id, restaurant_id, collector_id, amount, attempts, last_attempt_at)
    values (v_order.id, v_order.restaurant_id, v_settings.collector_id, v_order.total, 1, now())
    returning * into v_charge;
  else
    if v_charge.status <> 'creating' or v_charge.attempts >= 20
       or (v_charge.last_attempt_at is not null and v_charge.last_attempt_at > now() - make_interval(secs => greatest(coalesce(p_retry_after_seconds, 0), 0))) then
      return;
    end if;
    select s.* into v_settings from public.restaurant_pix_settings s
     where s.restaurant_id = v_order.restaurant_id and s.collector_id = v_charge.collector_id;
    if v_settings.restaurant_id is null then
      -- token removido ou trocado de conta no meio da criação: não dá para retomar com segurança
      update public.order_pix_charges set status = 'failed', failure_reason = 'settings_changed' where id = v_charge.id;
      return;
    end if;
    update public.order_pix_charges c set attempts = c.attempts + 1, last_attempt_at = now() where c.id = v_charge.id
    returning c.* into v_charge;
  end if;

  return query select v_charge.id, v_order.restaurant_id, v_order.order_number, v_charge.amount, v_order.restaurant_name,
                      v_settings.token_ciphertext, v_charge.collector_id, v_charge.attempts;
end;
$$;

-- Cobrança criada no Mercado Pago: 'creating' -> 'pending'. Valor tem de ser o reservado.
create or replace function public.pix_charge_register_backend(
  p_charge uuid, p_provider_payment_id text, p_amount numeric, p_qr_code text, p_expires_at timestamptz)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_charge record;
begin
  select * into v_charge from public.order_pix_charges where id = p_charge for update;
  if v_charge.id is null then raise exception 'charge_not_found' using errcode = '22023'; end if;
  if v_charge.status <> 'creating' then
    -- já registrada (corrida entre duas tentativas com a mesma idempotência): só aceita se for o MESMO pagamento
    if v_charge.provider_payment_id is not distinct from p_provider_payment_id then return v_charge.status; end if;
    raise exception 'charge_not_creating' using errcode = '22023';
  end if;
  if p_amount is distinct from v_charge.amount then raise exception 'amount_mismatch' using errcode = '22023'; end if;
  update public.order_pix_charges
     set status = 'pending', provider_payment_id = p_provider_payment_id, qr_code = p_qr_code, expires_at = p_expires_at
   where id = p_charge;
  return 'pending';
end;
$$;

-- Recusa DEFINITIVA do provedor (token inválido, dados recusados): 'creating' -> 'failed'. A página passa a
-- mostrar a chave Pix comum com conferência manual (nenhum QR automático foi mostrado ao cliente).
create or replace function public.pix_charge_fail_backend(p_charge uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.order_pix_charges set status = 'failed', failure_reason = p_reason
   where id = p_charge and status = 'creating';
end;
$$;

-- Cobrança + credenciais para consultar o Mercado Pago. Pelo id do provedor (webhook: QUALQUER status, para a
-- assinatura ser sempre conferida e a aprovação atrasada de cobrança cancelada/expirada valer; o app não consulta
-- o provedor para cobrança já paga) ou pelo pedido (página: só pendente, com throttle).
-- O throttle só se aplica com p_min_interval_seconds > 0 (página); o webhook usa 0 e nunca é descartado.
create or replace function public.pix_charge_for_sync_backend(
  p_provider_payment_id text, p_slug text, p_public_id uuid, p_min_interval_seconds integer)
returns table (charge_id uuid, restaurant_id uuid, provider_payment_id text, status text, amount numeric,
               collector_id text, order_public_id uuid, token_ciphertext text, webhook_secret_ciphertext text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if p_provider_payment_id is not null then
    select c.id into v_id from public.order_pix_charges c where c.provider_payment_id = p_provider_payment_id;
  else
    select c.id into v_id
      from public.order_pix_charges c
      join public.orders o on o.id = c.order_id
      join public.restaurants r on r.id = o.restaurant_id
     where r.slug = p_slug and o.public_id = p_public_id and c.status = 'pending';
  end if;
  if v_id is null then return; end if;

  update public.order_pix_charges c
     set last_checked_at = now()
   where c.id = v_id
     and (coalesce(p_min_interval_seconds, 0) <= 0 or c.last_checked_at is null
          or c.last_checked_at < now() - make_interval(secs => p_min_interval_seconds));
  if not found then return; end if;

  return query
    select c.id, c.restaurant_id, c.provider_payment_id, c.status, c.amount, c.collector_id, o.public_id,
           s.token_ciphertext, s.webhook_secret_ciphertext
      from public.order_pix_charges c
      join public.orders o on o.id = c.order_id
      join public.restaurant_pix_settings s on s.restaurant_id = c.restaurant_id and s.collector_id = c.collector_id
     where c.id = v_id;
end;
$$;

-- Aplica o estado LIDO NA API do Mercado Pago. approved só com valor, moeda, conta recebedora e referência
-- iguais; pago é final; aprovação atrasada (depois de cancelado/expirado no nosso lado) ainda vale.
create or replace function public.pix_charge_apply_backend(
  p_provider_payment_id text, p_status text, p_amount numeric, p_external_reference text,
  p_currency text, p_collector_id text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_charge record;
begin
  if p_status not in ('pending', 'approved', 'cancelled', 'expired') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  select c.*, o.public_id as order_public_id into v_charge
    from public.order_pix_charges c join public.orders o on o.id = c.order_id
   where c.provider_payment_id = p_provider_payment_id
   for update of c;
  if v_charge.id is null then raise exception 'charge_not_found' using errcode = '22023'; end if;

  if v_charge.status = 'approved' or p_status = 'pending' then
    return v_charge.status;  -- pago é final; "pendente" nunca rebaixa nada (evento atrasado/fora de ordem)
  end if;

  if p_status = 'approved' then
    if p_amount is distinct from v_charge.amount
       or p_external_reference is distinct from v_charge.order_public_id::text
       or p_currency is distinct from 'BRL'
       or p_collector_id is distinct from v_charge.collector_id then
      raise exception 'payment_mismatch' using errcode = '22023';
    end if;
    update public.order_pix_charges set status = 'approved', approved_at = now() where id = v_charge.id;
    update public.orders set paid_at = coalesce(paid_at, now()) where id = v_charge.order_id;
    return 'approved';
  end if;

  if v_charge.status = 'pending' then
    update public.order_pix_charges set status = p_status where id = v_charge.id;
    return p_status;
  end if;
  return v_charge.status;  -- cancelado/expirado repetido: nada muda
end;
$$;

-- ============================================================
-- 5. privilégios
-- ============================================================
revoke all on function public.pix_settings_status(uuid) from public, anon;
revoke all on function public.pix_settings_save(uuid, text, text, text) from public, anon;
revoke all on function public.pix_settings_save_webhook_secret(uuid, text) from public, anon;
revoke all on function public.pix_settings_set_enabled(uuid, boolean) from public, anon;
revoke all on function public.pix_settings_delete(uuid) from public, anon;
grant execute on function public.pix_settings_status(uuid) to authenticated;
grant execute on function public.pix_settings_save(uuid, text, text, text) to authenticated;
grant execute on function public.pix_settings_save_webhook_secret(uuid, text) to authenticated;
grant execute on function public.pix_settings_set_enabled(uuid, boolean) to authenticated;
grant execute on function public.pix_settings_delete(uuid) to authenticated;

revoke all on function public.get_order_pix_charge(text, uuid) from public;
grant execute on function public.get_order_pix_charge(text, uuid) to anon, authenticated;

revoke all on function public.pix_charge_begin_backend(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.pix_charge_register_backend(uuid, text, numeric, text, timestamptz) from public, anon, authenticated;
revoke all on function public.pix_charge_fail_backend(uuid, text) from public, anon, authenticated;
revoke all on function public.pix_charge_for_sync_backend(text, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.pix_charge_apply_backend(text, text, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.pix_charge_begin_backend(text, uuid, integer) to service_role;
grant execute on function public.pix_charge_register_backend(uuid, text, numeric, text, timestamptz) to service_role;
grant execute on function public.pix_charge_fail_backend(uuid, text) to service_role;
grant execute on function public.pix_charge_for_sync_backend(text, text, uuid, integer) to service_role;
grant execute on function public.pix_charge_apply_backend(text, text, numeric, text, text, text) to service_role;
