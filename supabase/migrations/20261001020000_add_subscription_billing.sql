-- MenuNext — Plano/Billing (decisão tomada com o usuário): planos
-- gerenciados pelo MASTER (nome/preço reais cadastrados por ele, nunca
-- inventados aqui), assinatura por restaurante via gateway Asaas, bloqueio
-- total (painel + loja pública) quando a assinatura fica overdue/cancelled.
--
-- Nenhum restaurante existente muda de comportamento: subscription_status
-- nasce 'active' por padrão (sem plano selecionado) — o mesmo "sem
-- cobrança" de hoje. Bloqueio só passa a valer depois que o próprio dono
-- assina um plano pago de verdade e esse pagamento falha.

-- ============================================================
-- 1. plans — CRUD do MASTER, mesmo padrão de collection-CRUD já usado para
--    delivery_zones/coupons (RLS direta, sem RPC própria de escrita — só
--    troca is_restaurant_member() por is_platform_admin()).
-- ============================================================
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  description text check (description is null or length(description) <= 500),
  price numeric(10, 2) not null check (price >= 0),
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index plans_name_unique_idx on public.plans (lower(trim(name)));

create trigger set_updated_at before update on public.plans
  for each row execute function public.set_updated_at();

alter table public.plans enable row level security;

-- Leitura liberada a qualquer autenticado (lojista precisa ver os planos
-- disponíveis em /painel/plano); escrita só para MASTER.
create policy "plans_select_authenticated" on public.plans
  for select to authenticated using (true);
create policy "plans_insert_master" on public.plans
  for insert to authenticated with check (public.is_platform_admin());
create policy "plans_update_master" on public.plans
  for update to authenticated using (public.is_platform_admin());
create policy "plans_delete_master" on public.plans
  for delete to authenticated using (public.is_platform_admin());

-- ============================================================
-- 2. billing_settings — singleton (mesmo padrão de platform_settings),
--    guarda o token de webhook do Asaas. Diferente de platform_settings,
--    SEM policy de select — nenhum authenticated pode ler isto via
--    PostgREST (vazaria o segredo do webhook para todo lojista logado); só
--    a RPC process_asaas_webhook lê, via SECURITY DEFINER (bypassa RLS).
-- ============================================================
create table public.billing_settings (
  id boolean primary key default true check (id),
  asaas_webhook_token text,
  updated_at timestamptz not null default now()
);

insert into public.billing_settings (id) values (true);

create trigger set_updated_at before update on public.billing_settings
  for each row execute function public.set_updated_at();

alter table public.billing_settings enable row level security;
-- Nenhuma policy de select/insert/update/delete — tabela inacessível via
-- PostgREST para qualquer role; só SECURITY DEFINER toca nela.

create or replace function public.update_billing_settings(p_asaas_webhook_token text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.billing_settings
  set asaas_webhook_token = nullif(trim(coalesce(p_asaas_webhook_token, '')), '')
  where id = true;
end;
$$;

revoke all on function public.update_billing_settings(text) from public, anon;
grant execute on function public.update_billing_settings(text) to authenticated;

-- ============================================================
-- 3. asaas_webhook_events — log/idempotência dos eventos recebidos (Asaas
--    pode reenviar o mesmo evento; o unique em asaas_event_id garante que
--    um reenvio nunca reprocessa a mudança de status duas vezes). Sem
--    policy de select — só a RPC grava, auditoria futura fica fora de
--    escopo desta entrega.
-- ============================================================
create table public.asaas_webhook_events (
  id uuid primary key default gen_random_uuid(),
  asaas_event_id text not null unique,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

alter table public.asaas_webhook_events enable row level security;

-- ============================================================
-- 4. restaurants — colunas de assinatura. Protegidas por REVOKE de coluna
--    (mesmo padrão de profiles.is_master): a policy restaurants_update_members
--    já libera a LINHA inteira para qualquer membro (usada por telas como
--    Aparência/Delivery via update direto), então sem este REVOKE um
--    STAFF/OWNER poderia setar a própria assinatura como 'active' direto
--    pela API. Só SECURITY DEFINER (RPCs abaixo) escreve nestas colunas.
-- ============================================================
alter table public.restaurants
  add column plan_id uuid references public.plans (id) on delete set null,
  add column subscription_status text not null default 'active'
    check (subscription_status in ('active', 'pending', 'overdue', 'cancelled')),
  add column asaas_customer_id text,
  add column asaas_subscription_id text,
  add column subscription_current_period_end timestamptz;

create index restaurants_asaas_subscription_id_idx on public.restaurants (asaas_subscription_id)
  where asaas_subscription_id is not null;

revoke update (plan_id, subscription_status, asaas_customer_id, asaas_subscription_id, subscription_current_period_end)
  on public.restaurants from authenticated;

-- ============================================================
-- 5. start_restaurant_subscription — chamada pelo dono (OWNER) depois que
--    o servidor Next.js já criou o customer+subscription no Asaas (API
--    externa, fora do banco). Esta RPC só grava o resultado — nunca chama
--    o Asaas ela mesma (Postgres não tem acesso de rede). Mesmo padrão de
--    derivar o restaurante do caller via restaurant_members usado em
--    create_restaurant_invite/remove_restaurant_member.
-- ============================================================
create or replace function public.start_restaurant_subscription(
  p_plan_id uuid,
  p_asaas_customer_id text,
  p_asaas_subscription_id text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid;
  v_role text;
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

  if not exists (select 1 from public.plans where id = p_plan_id and is_active = true) then
    raise exception 'plan_not_found' using errcode = '22023';
  end if;

  if p_asaas_customer_id is null or trim(p_asaas_customer_id) = ''
     or p_asaas_subscription_id is null or trim(p_asaas_subscription_id) = '' then
    raise exception 'invalid_asaas_reference' using errcode = '22023';
  end if;

  update public.restaurants
  set plan_id = p_plan_id,
      asaas_customer_id = p_asaas_customer_id,
      asaas_subscription_id = p_asaas_subscription_id,
      subscription_status = 'pending'
  where id = v_restaurant_id;
end;
$$;

revoke all on function public.start_restaurant_subscription(uuid, text, text) from public, anon;
grant execute on function public.start_restaurant_subscription(uuid, text, text) to authenticated;

-- ============================================================
-- 6. process_asaas_webhook — chamada pela rota Next.js
--    /api/webhooks/asaas (server-to-server, sem sessão de usuário — por
--    isso autoriza via token, nunca via auth.uid()). Idempotente: um
--    asaas_event_id repetido não reprocessa (on conflict do insert não
--    dispara exceção, só silenciosamente não repete a atualização).
--    p_new_status já vem traduzido do evento Asaas pelo código Next.js
--    (ex.: PAYMENT_CONFIRMED -> 'active', PAYMENT_OVERDUE -> 'overdue') —
--    a RPC só valida que é um dos 4 valores conhecidos.
-- ============================================================
create or replace function public.process_asaas_webhook(
  p_webhook_token text,
  p_asaas_event_id text,
  p_event_type text,
  p_asaas_subscription_id text,
  p_new_status text,
  p_current_period_end timestamptz default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_stored_token text;
begin
  select asaas_webhook_token into v_stored_token from public.billing_settings where id = true;

  if v_stored_token is null or p_webhook_token is null or p_webhook_token <> v_stored_token then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_new_status not in ('active', 'pending', 'overdue', 'cancelled') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  insert into public.asaas_webhook_events (asaas_event_id, event_type, payload)
  values (p_asaas_event_id, p_event_type, jsonb_build_object(
    'asaas_subscription_id', p_asaas_subscription_id,
    'new_status', p_new_status
  ))
  on conflict (asaas_event_id) do nothing;

  -- FOUND fica false quando o ON CONFLICT DO NOTHING suprimiu o insert
  -- (evento repetido) — nesse caso o status já foi aplicado da primeira
  -- vez, não reprocessa.
  if not found then
    return;
  end if;

  update public.restaurants
  set subscription_status = p_new_status,
      subscription_current_period_end = coalesce(p_current_period_end, subscription_current_period_end)
  where asaas_subscription_id = p_asaas_subscription_id;
end;
$$;

revoke all on function public.process_asaas_webhook(text, text, text, text, text, timestamptz) from public, authenticated;
grant execute on function public.process_asaas_webhook(text, text, text, text, text, timestamptz) to anon;

-- ============================================================
-- 7. get_public_restaurant_by_slug — adiciona subscription_blocked
--    (boolean calculado, nunca o status/IDs do Asaas crus — a loja pública
--    não deve expor detalhes de billing). RETURNS TABLE muda, precisa de
--    DROP + CREATE (mesmo padrão já usado 3x nesta sessão para esta RPC).
-- ============================================================
drop function public.get_public_restaurant_by_slug(text);

create function public.get_public_restaurant_by_slug(p_slug text)
returns table(id uuid, name text, slug text, status text, onboarding_completed boolean, logo_path text, cover_path text, service_delivery boolean, service_pickup boolean, delivery_fee numeric, delivery_radius_km numeric, delivery_fee_method text, latitude numeric, longitude numeric, minimum_order_value numeric, estimated_delivery_min_minutes integer, estimated_delivery_max_minutes integer, payment_pix boolean, payment_cash boolean, payment_card boolean, bio text, contact_whatsapp text, theme_primary_color text, subscription_blocked boolean)
language sql
stable security definer
set search_path to 'public'
as $function$
  select r.id, r.name, r.slug, r.status, r.onboarding_completed, r.logo_path, r.cover_path,
         r.service_delivery, r.service_pickup, r.delivery_fee, r.delivery_radius_km,
         r.delivery_fee_method, r.latitude, r.longitude,
         r.minimum_order_value, r.estimated_delivery_min_minutes, r.estimated_delivery_max_minutes,
         r.payment_pix, r.payment_cash, r.payment_card,
         r.bio, r.contact_whatsapp, r.theme_primary_color,
         r.subscription_status in ('overdue', 'cancelled') as subscription_blocked
  from public.restaurants r
  where r.slug = p_slug
    and r.onboarding_completed = true;
$function$;

revoke all on function public.get_public_restaurant_by_slug(text) from public;
grant execute on function public.get_public_restaurant_by_slug(text) to anon, authenticated;
