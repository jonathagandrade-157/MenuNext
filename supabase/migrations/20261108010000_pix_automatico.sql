-- MenuNext — Pix com confirmação automática (v1, Mercado Pago da PRÓPRIA loja). DESLIGADO por padrão.
--
-- Nunca aplicada em produção por este repositório; validada em PostgreSQL sintético (supabase/tests/pix_automatico.sql).
--
-- MODELO
--   * O dinheiro vai direto para a conta Mercado Pago da loja: o MenuNext nunca recebe nem repassa valores.
--   * O OWNER cola o Access Token da conta dele no painel. O SERVIDOR cifra o token (AES-256-GCM, chave
--     PAYMENTS_ENCRYPTION_KEY que nunca entra no banco) e grava só o texto cifrado + os 4 últimos caracteres.
--     Ninguém lê o token pela API do banco: só o backend (service_role), para falar com o Mercado Pago.
--   * Pedido com Pix numa loja com o recurso ligado: o backend cria UMA cobrança Pix dinâmica com o valor do
--     pedido lido do banco e guarda o "copia e cola". Confirmação: o backend consulta o pagamento NA API do
--     Mercado Pago (webhook e consulta da página do pedido só disparam a consulta; o corpo do webhook nunca é
--     usado como prova) e só marca pago se valor e referência baterem. Pago é final.
--   * Sem o recurso ligado (padrão) nada muda: o Pix segue pela chave estática da loja.
--
-- O QUE CRIA
--   1. restaurant_pix_settings — token cifrado + ligado/desligado (sem nenhum acesso de anon/authenticated).
--   2. order_pix_charges — a cobrança de cada pedido (membros da loja leem; só o backend escreve).
--   3. orders.paid_at — quando o pagamento foi confirmado (só as funções de backend escrevem).
--   4. RPCs: OWNER configura (pix_settings_*); visitante vê a cobrança do próprio pedido (get_order_pix_charge);
--      backend (service_role) cria/consulta/aplica (pix_*_backend).

-- ============================================================
-- 1. configuração por loja
-- ============================================================
create table public.restaurant_pix_settings (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  provider text not null default 'mercadopago' check (provider = 'mercadopago'),
  token_ciphertext text not null check (token_ciphertext ~ '^v1:[A-Za-z0-9+/=_-]+:[A-Za-z0-9+/=_-]+:[A-Za-z0-9+/=_-]+$' and char_length(token_ciphertext) <= 4000),
  token_hint text not null check (token_hint ~ '^[A-Za-z0-9_-]{1,4}$'),
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
  provider_payment_id text not null unique check (provider_payment_id ~ '^[0-9]{1,30}$'),
  amount numeric(10, 2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'cancelled', 'expired')),
  qr_code text not null check (char_length(qr_code) between 20 and 1000),
  expires_at timestamptz,
  approved_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_pix_charges_approved_at check ((status = 'approved') = (approved_at is not null))
);

create index order_pix_charges_restaurant_idx on public.order_pix_charges (restaurant_id, created_at desc);
create index order_pix_charges_pending_idx on public.order_pix_charges (created_at) where status = 'pending';

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
-- 4a. OWNER: configuração (o token chega JÁ CIFRADO pelo servidor; nunca é devolvido)
-- ============================================================
create or replace function public.pix_settings_status(p_restaurant uuid)
returns table (configured boolean, enabled boolean, token_hint text, updated_at timestamptz)
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
    select true, s.enabled, s.token_hint, s.updated_at from public.restaurant_pix_settings s where s.restaurant_id = p_restaurant
    union all
    select false, false, null::text, null::timestamptz
     where not exists (select 1 from public.restaurant_pix_settings s where s.restaurant_id = p_restaurant);
end;
$$;

create or replace function public.pix_settings_save(p_restaurant uuid, p_ciphertext text, p_hint text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_restaurant_owner(p_restaurant) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  -- token novo nasce DESLIGADO: o OWNER liga depois de conferir
  insert into public.restaurant_pix_settings (restaurant_id, token_ciphertext, token_hint, enabled, updated_by)
  values (p_restaurant, p_ciphertext, p_hint, false, auth.uid())
  on conflict (restaurant_id) do update
    set token_ciphertext = excluded.token_ciphertext, token_hint = excluded.token_hint, enabled = false, updated_by = auth.uid();
exception
  when check_violation then
    raise exception 'invalid_token' using errcode = '22023';
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

-- Contexto para criar a cobrança: só pedido Pix, não cancelado, sem cobrança, de loja com o recurso LIGADO.
create or replace function public.pix_charge_context_backend(p_slug text, p_public_id uuid)
returns table (order_id uuid, restaurant_id uuid, order_number integer, total numeric, restaurant_name text,
               token_ciphertext text, has_charge boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  select o.id, r.id, o.order_number, o.total, r.name, s.token_ciphertext,
         exists (select 1 from public.order_pix_charges c where c.order_id = o.id)
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
    join public.restaurant_pix_settings s on s.restaurant_id = r.id and s.enabled
   where r.slug = p_slug and o.public_id = p_public_id
     and o.payment_method = 'pix' and o.status <> 'cancelled' and o.paid_at is null and o.total > 0;
$$;

-- Registra a cobrança criada no Mercado Pago. Valor TEM de ser o total do pedido; uma cobrança por pedido.
create or replace function public.pix_charge_register_backend(
  p_order uuid, p_provider_payment_id text, p_amount numeric, p_qr_code text, p_expires_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order record;
  v_id uuid;
begin
  select o.id, o.restaurant_id, o.total, o.payment_method, o.status into v_order
    from public.orders o where o.id = p_order for update;
  if v_order.id is null then raise exception 'order_not_found' using errcode = '22023'; end if;
  if v_order.payment_method <> 'pix' or v_order.status = 'cancelled' then
    raise exception 'order_not_pix' using errcode = '22023';
  end if;
  if p_amount is distinct from v_order.total then raise exception 'amount_mismatch' using errcode = '22023'; end if;
  insert into public.order_pix_charges (order_id, restaurant_id, provider_payment_id, amount, qr_code, expires_at)
  values (v_order.id, v_order.restaurant_id, p_provider_payment_id, p_amount, p_qr_code, p_expires_at)
  on conflict (order_id) do nothing
  returning id into v_id;
  if v_id is null then raise exception 'charge_exists' using errcode = '23505'; end if;
  return v_id;
end;
$$;

-- Cobrança + token para consultar o Mercado Pago. Throttle: com p_min_interval > 0, só devolve se a última
-- consulta foi há mais tempo (e marca agora), para a página do pedido e o webhook não martelarem a API.
create or replace function public.pix_charge_for_sync_backend(
  p_provider_payment_id text, p_slug text, p_public_id uuid, p_min_interval_seconds integer)
returns table (charge_id uuid, restaurant_id uuid, provider_payment_id text, status text, amount numeric,
               order_public_id uuid, token_ciphertext text)
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
     where r.slug = p_slug and o.public_id = p_public_id;
  end if;
  if v_id is null then return; end if;

  update public.order_pix_charges c
     set last_checked_at = now()
   where c.id = v_id and c.status = 'pending'
     and (coalesce(p_min_interval_seconds, 0) <= 0 or c.last_checked_at is null
          or c.last_checked_at < now() - make_interval(secs => p_min_interval_seconds));
  if not found then return; end if;

  return query
    select c.id, c.restaurant_id, c.provider_payment_id, c.status, c.amount, o.public_id, s.token_ciphertext
      from public.order_pix_charges c
      join public.orders o on o.id = c.order_id
      join public.restaurant_pix_settings s on s.restaurant_id = c.restaurant_id
     where c.id = v_id;
end;
$$;

-- Aplica o estado LIDO NA API do Mercado Pago. approved só com valor e referência iguais; pago é final.
create or replace function public.pix_charge_apply_backend(
  p_provider_payment_id text, p_status text, p_amount numeric, p_external_reference text)
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

  if v_charge.status <> 'pending' or p_status = 'pending' then
    return v_charge.status;  -- final (ou nada mudou): nunca rebaixa um pago
  end if;

  if p_status = 'approved' then
    if p_amount is distinct from v_charge.amount or p_external_reference is distinct from v_charge.order_public_id::text then
      raise exception 'payment_mismatch' using errcode = '22023';
    end if;
    update public.order_pix_charges set status = 'approved', approved_at = now() where id = v_charge.id;
    update public.orders set paid_at = coalesce(paid_at, now()) where id = v_charge.order_id;
  else
    update public.order_pix_charges set status = p_status where id = v_charge.id;
  end if;
  return p_status;
end;
$$;

-- ============================================================
-- 5. privilégios
-- ============================================================
revoke all on function public.pix_settings_status(uuid) from public, anon;
revoke all on function public.pix_settings_save(uuid, text, text) from public, anon;
revoke all on function public.pix_settings_set_enabled(uuid, boolean) from public, anon;
revoke all on function public.pix_settings_delete(uuid) from public, anon;
grant execute on function public.pix_settings_status(uuid) to authenticated;
grant execute on function public.pix_settings_save(uuid, text, text) to authenticated;
grant execute on function public.pix_settings_set_enabled(uuid, boolean) to authenticated;
grant execute on function public.pix_settings_delete(uuid) to authenticated;

revoke all on function public.get_order_pix_charge(text, uuid) from public;
grant execute on function public.get_order_pix_charge(text, uuid) to anon, authenticated;

revoke all on function public.pix_charge_context_backend(text, uuid) from public, anon, authenticated;
revoke all on function public.pix_charge_register_backend(uuid, text, numeric, text, timestamptz) from public, anon, authenticated;
revoke all on function public.pix_charge_for_sync_backend(text, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.pix_charge_apply_backend(text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.pix_charge_context_backend(text, uuid) to service_role;
grant execute on function public.pix_charge_register_backend(uuid, text, numeric, text, timestamptz) to service_role;
grant execute on function public.pix_charge_for_sync_backend(text, text, uuid, integer) to service_role;
grant execute on function public.pix_charge_apply_backend(text, text, numeric, text) to service_role;
