-- MenuNext — leitura de restaurantes pelo MASTER (lista + detalhe).
--
-- Nenhuma policy nova em restaurants/orders: abrir SELECT total ao master
-- exporia chaves Pix, telefones de clientes e IDs de cobrança de todos os
-- lojistas. Em vez disso, duas RPCs SECURITY DEFINER devolvem só os campos e
-- agregados que as telas precisam, e re-checam is_platform_admin() por
-- dentro (mesma convenção das demais RPCs do projeto).

-- ============================================================
-- 1. Lista paginada, com busca por nome/slug e filtro de assinatura.
--    A busca usa position() em vez de ILIKE para que %, _ digitados pelo
--    usuário não virem curinga.
-- ============================================================
create or replace function public.master_list_restaurants(
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
  total_count bigint
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
         count(*) over ()
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

-- ============================================================
-- 2. Detalhe de um restaurante: cadastro, assinatura, responsável e
--    agregados de pedidos/cardápio. Nunca devolve CPF/CNPJ, chave Pix nem
--    dados de clientes (só a contagem de telefones distintos). "Hoje" e
--    "mês" seguem o fuso de São Paulo, como o restante do produto.
--    Pedidos concluídos = delivered (entrega) ou picked_up (retirada/balcão).
-- ============================================================
create or replace function public.master_get_restaurant(p_restaurant_id uuid)
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
  open_business_days bigint
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
         (select count(*) from public.business_hours bh where bh.restaurant_id = r.id)
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
