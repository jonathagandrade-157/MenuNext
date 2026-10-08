-- MenuNext — métricas da plataforma para o MASTER (/master/metricas), em uma
-- única RPC que devolve só agregados (nenhuma linha de restaurante, cliente
-- ou pedido, exceto o ranking dos 5 restaurantes de maior volume).
-- Mesma convenção das demais: SECURITY DEFINER, re-checa is_platform_admin().
--
-- Período = últimos N dias (7, 30 ou 90; qualquer outro valor vira 30),
-- contando hoje, no fuso de São Paulo. Variação compara com a janela
-- anterior de mesmo tamanho.
--
-- Decisões de dado (nada estimado):
-- - Churn usa asaas_webhook_events (tem processed_at): cancelamentos =
--   assinaturas distintas com evento 'cancelled' no período. O
--   restaurants.subscription_status não tem data de cancelamento.
-- - Não há histórico de assinaturas, então não existe "evolução do MRR";
--   só o MRR de hoje.
-- - "Valor transacionado" (GMV) = soma de orders.total sem cancelados. É o
--   volume dos restaurantes, não faturamento do MenuNext.
-- - Conversão do trial só considera donos cujo trial TEM data e já acabou;
--   dono sem trial (documento já usado) não é "trial não convertido".

create or replace function public.master_metrics(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_tz constant text := 'America/Sao_Paulo';
  v_days integer := case when p_days in (7, 30, 90) then p_days else 30 end;
  v_now timestamptz := now();
  v_local_today timestamp := date_trunc('day', v_now at time zone v_tz);
  v_start timestamptz := (v_local_today - make_interval(days => v_days - 1)) at time zone v_tz;
  v_prev_start timestamptz := (v_local_today - make_interval(days => 2 * v_days - 1)) at time zone v_tz;
  v_new integer;
  v_new_with_orders integer;
begin
  if not public.is_platform_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select count(*),
         count(*) filter (where exists (select 1 from public.orders od where od.restaurant_id = r.id))
  into v_new, v_new_with_orders
  from public.restaurants r
  where r.created_at >= v_start;

  return jsonb_build_object(
    'period_days', v_days,
    'mrr', coalesce((
      select sum(pl.price)
      from public.restaurants r
      join public.plans pl on pl.id = r.plan_id
      where r.subscription_status = 'active'
    ), 0),
    'subscribers_active', (
      select count(*) from public.restaurants where plan_id is not null and subscription_status = 'active'
    ),
    'restaurants_active', (
      select count(*) from public.restaurants where status = 'active' and onboarding_completed
    ),
    'new_restaurants', v_new,
    'new_restaurants_prev', (
      select count(*) from public.restaurants where created_at >= v_prev_start and created_at < v_start
    ),
    'new_with_orders', v_new_with_orders,
    'activated_in_period', (
      select count(*) from (
        select od.restaurant_id from public.orders od group by od.restaurant_id having min(od.created_at) >= v_start
      ) f
    ),
    'cancellations', (
      select count(distinct e.payload ->> 'asaas_subscription_id')
      from public.asaas_webhook_events e
      where e.payload ->> 'new_status' = 'cancelled' and e.processed_at >= v_start
    ),
    'trial', jsonb_build_object(
      'started', (select count(*) from public.profiles where trial_started_at is not null and trial_started_at >= v_start),
      'active_now', (select count(*) from public.profiles where trial_ends_at is not null and trial_ends_at > v_now),
      'expiring_7d', (
        select count(*) from public.profiles
        where trial_ends_at is not null and trial_ends_at > v_now and trial_ends_at <= v_now + interval '7 days'
      ),
      'converted', (
        select count(*) from public.restaurants r
        where r.plan_id is not null
          and r.subscription_status in ('active', 'pending')
          and exists (
            select 1 from public.restaurant_members rm
            join public.profiles p on p.user_id = rm.user_id
            where rm.restaurant_id = r.id and rm.role = 'OWNER'
              and p.trial_ends_at is not null and p.trial_ends_at <= v_now
          )
      ),
      'expired_unsubscribed', (
        select count(*) from public.restaurants r
        where public._restaurant_access_state(r.id) = 'trial_expired'
          and exists (
            select 1 from public.restaurant_members rm
            join public.profiles p on p.user_id = rm.user_id
            where rm.restaurant_id = r.id and rm.role = 'OWNER' and p.trial_ends_at is not null
          )
      )
    ),
    'funnel', jsonb_build_object(
      'registered', v_new,
      'onboarding_done', (
        select count(*) from public.restaurants where created_at >= v_start and onboarding_completed
      ),
      'with_products', (
        select count(*) from public.restaurants r
        where r.created_at >= v_start and exists (select 1 from public.products pr where pr.restaurant_id = r.id)
      ),
      'published', (
        select count(*) from public.restaurants
        where created_at >= v_start and status = 'active' and onboarding_completed
      ),
      'with_orders', v_new_with_orders
    ),
    'volume', jsonb_build_object(
      'orders', (select count(*) from public.orders where created_at >= v_start),
      'valid_orders', (select count(*) from public.orders where created_at >= v_start and status <> 'cancelled'),
      'gmv', coalesce((select sum(total) from public.orders where created_at >= v_start and status <> 'cancelled'), 0),
      'operating_restaurants', (select count(distinct restaurant_id) from public.orders where created_at >= v_start)
    ),
    'orders_by_day', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'date', to_char(d.day, 'YYYY-MM-DD'),
          'orders', coalesce(o.orders, 0),
          'gmv', coalesce(o.gmv, 0)
        ) order by d.day
      ), '[]'::jsonb)
      from generate_series(v_local_today - make_interval(days => v_days - 1), v_local_today, interval '1 day') as d(day)
      left join (
        select date_trunc('day', od.created_at at time zone v_tz) as day,
               count(*) as orders,
               coalesce(sum(od.total) filter (where od.status <> 'cancelled'), 0) as gmv
        from public.orders od
        where od.created_at >= v_start
        group by 1
      ) o on o.day = d.day
    ),
    'top_restaurants', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.orders desc, t.gmv desc), '[]'::jsonb)
      from (
        select r.id, r.name, r.slug, pl.name as plan_name,
               count(*) as orders,
               coalesce(sum(od.total) filter (where od.status <> 'cancelled'), 0) as gmv,
               max(od.created_at) as last_order_at
        from public.orders od
        join public.restaurants r on r.id = od.restaurant_id
        left join public.plans pl on pl.id = r.plan_id
        where od.created_at >= v_start
        group by r.id, r.name, r.slug, pl.name
        order by count(*) desc, coalesce(sum(od.total) filter (where od.status <> 'cancelled'), 0) desc
        limit 5
      ) t
    ),
    'plans', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'plan_id', pl.id,
          'name', pl.name,
          'price', pl.price,
          'is_active', pl.is_active,
          'subscribers', (
            select count(*) from public.restaurants r
            where r.plan_id = pl.id and r.subscription_status = 'active'
          )
        ) order by pl.display_order, pl.price
      ), '[]'::jsonb)
      from public.plans pl
    )
  );
end;
$$;

revoke all on function public.master_metrics(integer) from public, anon;
grant execute on function public.master_metrics(integer) to authenticated;
