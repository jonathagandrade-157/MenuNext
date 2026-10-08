-- MenuNext — bloqueio total quando o trial acaba sem assinatura (decisão do
-- usuário: mesmo bloqueio da inadimplência, painel + loja pública).
--
-- Antes, nada expirava o trial de 30 dias gravado no cadastro: quem nunca
-- assinava usava o produto de graça para sempre; o bloqueio só valia para
-- quem já tinha assinado e atrasou.
--
-- Estado de acesso, calculado na hora (sem cron, sem job): uma única função
-- interna decide, e todos os pontos de bloqueio usam ela.
--   'overdue' / 'cancelled'  assinatura com pagamento atrasado / cancelada
--   'trial_expired'          sem plano e nenhum OWNER com trial em vigor
--   null                     liberado
-- Regras:
-- - Quem tem plano ativo ou aguardando 1º pagamento ('pending') não é
--   bloqueado por trial: o trial só governa quem não tem plano.
-- - OWNER sem trial (documento já usado em outro cadastro) é bloqueado de
--   imediato: tratar "sem trial" como isento abriria brecha para burlar a
--   regra de 1 documento = 1 trial.
-- - Restaurante cujo OWNER é master da plataforma é isento (loja do próprio
--   operador); sem isso, a loja de teste do master seria bloqueada.

-- ============================================================
-- 1. Função interna — sem EXECUTE para anon/authenticated; só as funções
--    SECURITY DEFINER abaixo (que rodam como dono) a chamam.
-- ============================================================
create or replace function public._restaurant_access_state(p_restaurant_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_plan_id uuid;
begin
  select r.subscription_status, r.plan_id into v_status, v_plan_id
  from public.restaurants r
  where r.id = p_restaurant_id;

  if not found then
    return null;
  end if;

  if v_status = 'overdue' then
    return 'overdue';
  end if;
  if v_status = 'cancelled' then
    return 'cancelled';
  end if;

  if v_plan_id is not null then
    return null;
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
-- 2. Estado de acesso do restaurante do usuário logado (painel). Mesma
--    derivação de restaurante por restaurant_members usada nas outras RPCs.
-- ============================================================
create or replace function public.get_my_access_state()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select public._restaurant_access_state(rm.restaurant_id)
  from public.restaurant_members rm
  where rm.user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.get_my_access_state() from public, anon;
grant execute on function public.get_my_access_state() to authenticated;

-- ============================================================
-- 3. create_order — ÚNICA mudança: a checagem de bloqueio passa a usar a
--    função de estado de acesso (cobre trial expirado além de
--    overdue/cancelled). create_order é o caminho de maior impacto do
--    produto, então o patch é aplicado sobre a definição VIGENTE no banco e
--    falha alto se a linha esperada não for encontrada exatamente uma vez,
--    em vez de reescrever a função inteira de memória.
-- ============================================================
do $patch$
declare
  v_def text;
  v_old constant text := $old$if v_restaurant.subscription_status in ('overdue', 'cancelled') then$old$;
  v_new constant text := $new$if public._restaurant_access_state(v_restaurant.id) is not null then$new$;
  v_occurrences integer;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_order';

  v_occurrences := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'create_order: esperava 1 ocorrencia da checagem de assinatura, achei %', v_occurrences;
  end if;

  execute replace(v_def, v_old, v_new);
end;
$patch$;

-- ============================================================
-- 4. Loja pública — subscription_blocked passa a refletir o mesmo estado
--    de acesso (mesma assinatura de retorno, create or replace basta).
-- ============================================================
create or replace function public.get_public_restaurant_by_slug(p_slug text)
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
         public._restaurant_access_state(r.id) is not null as subscription_blocked
  from public.restaurants r
  where r.slug = p_slug
    and r.onboarding_completed = true;
$function$;

-- ============================================================
-- 5. Master — as duas RPCs de restaurantes ganham access_state (o master
--    precisa ver quem está bloqueado por trial expirado, que não aparece em
--    subscription_status). Muda o RETURNS TABLE, então DROP + CREATE.
-- ============================================================
drop function public.master_list_restaurants(text, text, integer, integer);
drop function public.master_get_restaurant(uuid);

create function public.master_list_restaurants(
  p_search text default null,
  p_subscription_status text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  name text,
  slug text,
  status text,
  onboarding_completed boolean,
  created_at timestamptz,
  plan_name text,
  plan_price numeric,
  subscription_status text,
  orders_total bigint,
  last_order_at timestamptz,
  total_count bigint,
  access_state text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
begin
  if not public.is_platform_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return query
  select r.id,
         r.name,
         r.slug,
         r.status,
         r.onboarding_completed,
         r.created_at,
         pl.name,
         pl.price,
         r.subscription_status,
         coalesce(agg.orders_total, 0),
         agg.last_order_at,
         count(*) over (),
         public._restaurant_access_state(r.id)
  from public.restaurants r
  left join public.plans pl on pl.id = r.plan_id
  left join lateral (
    select count(*) as orders_total, max(od.created_at) as last_order_at
    from public.orders od
    where od.restaurant_id = r.id
  ) agg on true
  where (v_search is null
         or position(v_search in lower(r.name)) > 0
         or position(v_search in lower(r.slug)) > 0)
    and (p_subscription_status is null or r.subscription_status = p_subscription_status)
  order by r.created_at desc, r.id
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

revoke all on function public.master_list_restaurants(text, text, integer, integer) from public, anon;
grant execute on function public.master_list_restaurants(text, text, integer, integer) to authenticated;

create function public.master_get_restaurant(p_restaurant_id uuid)
returns table (
  id uuid,
  name text,
  slug text,
  status text,
  onboarding_completed boolean,
  onboarding_step integer,
  created_at timestamptz,
  contact_whatsapp text,
  contact_email text,
  plan_name text,
  plan_price numeric,
  subscription_status text,
  owner_name text,
  owner_email text,
  orders_total bigint,
  orders_today bigint,
  orders_month bigint,
  orders_completed bigint,
  orders_cancelled bigint,
  customers_unique bigint,
  first_order_at timestamptz,
  last_order_at timestamptz,
  products_count bigint,
  open_business_days bigint,
  access_state text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_day_start timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_month_start timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if not public.is_platform_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return query
  select r.id,
         r.name,
         r.slug,
         r.status,
         r.onboarding_completed,
         r.onboarding_step::integer,
         r.created_at,
         r.contact_whatsapp,
         r.contact_email,
         pl.name,
         pl.price,
         r.subscription_status,
         owner.owner_name,
         owner.owner_email,
         coalesce(agg.orders_total, 0),
         coalesce(agg.orders_today, 0),
         coalesce(agg.orders_month, 0),
         coalesce(agg.orders_completed, 0),
         coalesce(agg.orders_cancelled, 0),
         coalesce(agg.customers_unique, 0),
         agg.first_order_at,
         agg.last_order_at,
         (select count(*) from public.products pr where pr.restaurant_id = r.id),
         (select count(*) from public.business_hours bh where bh.restaurant_id = r.id),
         public._restaurant_access_state(r.id)
  from public.restaurants r
  left join public.plans pl on pl.id = r.plan_id
  left join lateral (
    select p.name as owner_name, u.email::text as owner_email
    from public.restaurant_members rm
    left join public.profiles p on p.user_id = rm.user_id
    left join auth.users u on u.id = rm.user_id
    where rm.restaurant_id = r.id and rm.role = 'OWNER'
    order by rm.created_at
    limit 1
  ) owner on true
  left join lateral (
    select count(*) as orders_total,
           count(*) filter (where od.created_at >= v_day_start) as orders_today,
           count(*) filter (where od.created_at >= v_month_start) as orders_month,
           count(*) filter (where od.status in ('delivered', 'picked_up')) as orders_completed,
           count(*) filter (where od.status = 'cancelled') as orders_cancelled,
           count(distinct od.customer_phone) as customers_unique,
           min(od.created_at) as first_order_at,
           max(od.created_at) as last_order_at
    from public.orders od
    where od.restaurant_id = r.id
  ) agg on true
  where r.id = p_restaurant_id;
end;
$$;

revoke all on function public.master_get_restaurant(uuid) from public, anon;
grant execute on function public.master_get_restaurant(uuid) to authenticated;
