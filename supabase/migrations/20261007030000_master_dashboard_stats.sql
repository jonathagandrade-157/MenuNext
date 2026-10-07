-- MenuNext — agregados do Dashboard Master em uma única RPC.
--
-- Mesma convenção das RPCs de master_restaurants: SECURITY DEFINER, re-checa
-- is_platform_admin() por dentro e devolve só agregados (nenhuma linha de
-- restaurante, cliente ou pedido). Datas de "hoje"/"mês" no fuso de São
-- Paulo, como o restante do produto.
--
-- Decisões de dado (nada estimado):
-- - Trial "em andamento" = trial_ends_at no futuro. O trial de 30 dias é
--   gravado no cadastro (handle_new_user), mas nada o expira, então
--   trial_status continua 'active' para sempre e não serve como filtro.
-- - Crescimento = restaurantes cadastrados acumulados ao fim de cada mês.
--   Não há histórico de status, então não dá para reconstruir "ativos"
--   por mês — o gráfico mostra cadastros, e diz isso.
-- - MRR = soma do preço do plano dos restaurantes com assinatura 'active'.

create or replace function public.master_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_tz constant text := 'America/Sao_Paulo';
  v_now timestamptz := now();
  v_local_now timestamp := v_now at time zone v_tz;
  v_day_start timestamptz := date_trunc('day', v_local_now) at time zone v_tz;
  v_yesterday_start timestamptz := (date_trunc('day', v_local_now) - interval '1 day') at time zone v_tz;
  v_month_start timestamptz := date_trunc('month', v_local_now) at time zone v_tz;
begin
  if not public.is_platform_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'restaurants_total', (select count(*) from public.restaurants),
    'restaurants_active', (
      select count(*) from public.restaurants where status = 'active' and onboarding_completed
    ),
    'restaurants_new_month', (select count(*) from public.restaurants where created_at >= v_month_start),
    'subscribers_active', (
      select count(*) from public.restaurants where plan_id is not null and subscription_status = 'active'
    ),
    'subscribers_pending', (
      select count(*) from public.restaurants where plan_id is not null and subscription_status = 'pending'
    ),
    'subscribers_overdue', (
      select count(*) from public.restaurants where plan_id is not null and subscription_status = 'overdue'
    ),
    'subscribers_cancelled', (
      select count(*) from public.restaurants where plan_id is not null and subscription_status = 'cancelled'
    ),
    'mrr', coalesce((
      select sum(pl.price)
      from public.restaurants r
      join public.plans pl on pl.id = r.plan_id
      where r.subscription_status = 'active'
    ), 0),
    'trials_active', (
      select count(*) from public.profiles where trial_ends_at is not null and trial_ends_at > v_now
    ),
    'trials_expiring_7d', (
      select count(*) from public.profiles
      where trial_ends_at is not null and trial_ends_at > v_now and trial_ends_at <= v_now + interval '7 days'
    ),
    'orders_today', (select count(*) from public.orders where created_at >= v_day_start),
    'orders_yesterday', (
      select count(*) from public.orders where created_at >= v_yesterday_start and created_at < v_day_start
    ),
    'orders_month', (select count(*) from public.orders where created_at >= v_month_start),
    'orders_total', (select count(*) from public.orders),
    'funnel', jsonb_build_object(
      'registered', (select count(*) from public.restaurants),
      'onboarding_done', (select count(*) from public.restaurants where onboarding_completed),
      'with_products', (select count(distinct restaurant_id) from public.products),
      'published', (select count(*) from public.restaurants where status = 'active' and onboarding_completed),
      'with_orders', (select count(distinct restaurant_id) from public.orders)
    ),
    'growth', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'month', to_char(m.local_month, 'YYYY-MM'),
          'total', (
            select count(*) from public.restaurants r
            where r.created_at < ((m.local_month + interval '1 month') at time zone v_tz)
          )
        ) order by m.local_month
      ), '[]'::jsonb)
      from (
        select gs as local_month
        from generate_series(
          date_trunc('month', v_local_now) - interval '11 months',
          date_trunc('month', v_local_now),
          interval '1 month'
        ) gs
      ) m
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

revoke all on function public.master_dashboard_stats() from public, anon;
grant execute on function public.master_dashboard_stats() to authenticated;
