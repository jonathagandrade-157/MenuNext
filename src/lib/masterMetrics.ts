import type { SupabaseClient } from "@supabase/supabase-js";
import type { FunnelCounts, GrowthPoint, PlanStat } from "./masterDashboard";

export const METRIC_PERIODS = [7, 30, 90] as const;
export type MetricPeriod = (typeof METRIC_PERIODS)[number];
export const DEFAULT_PERIOD: MetricPeriod = 30;

export type DayPoint = { date: string; orders: number; gmv: number };

export type TopRestaurant = {
  id: string;
  name: string;
  slug: string;
  plan_name: string | null;
  orders: number;
  gmv: number;
  last_order_at: string | null;
};

export type MasterMetrics = {
  period_days: MetricPeriod;
  mrr: number;
  subscribers_active: number;
  restaurants_active: number;
  new_restaurants: number;
  new_restaurants_prev: number;
  new_with_orders: number;
  activated_in_period: number;
  cancellations: number;
  trial: {
    started: number;
    active_now: number;
    expiring_7d: number;
    converted: number;
    expired_unsubscribed: number;
  };
  funnel: FunnelCounts;
  volume: { orders: number; valid_orders: number; gmv: number; operating_restaurants: number };
  orders_by_day: DayPoint[];
  top_restaurants: TopRestaurant[];
  plans: PlanStat[];
};

/** Período vindo da URL: só 7, 30 ou 90; qualquer outra coisa vira 30. */
export function parsePeriod(raw: string | string[] | undefined): MetricPeriod {
  const value = Number.parseInt(Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? ""), 10);
  return METRIC_PERIODS.find((period) => period === value) ?? DEFAULT_PERIOD;
}

/** % de `part` sobre `whole`; null (nunca 0%) quando não há base. */
export function percentOf(part: number, whole: number): number | null {
  return whole === 0 ? null : (part / whole) * 100;
}

/** Variação % contra o período anterior; null quando o anterior foi 0
 * (evita divisão por zero e um "+∞%" sem sentido). */
export function computeVariation(current: number, previous: number): number | null {
  return previous === 0 ? null : ((current - previous) / previous) * 100;
}

/** Churn do período: cancelamentos sobre (assinantes em dia hoje +
 * cancelamentos). Não há histórico de assinaturas para saber a base no início
 * do período, então esta é a aproximação honesta disponível. */
export function computeChurnRate(cancellations: number, activeSubscribers: number): number | null {
  return percentOf(cancellations, activeSubscribers + cancellations);
}

/** Dos trials já encerrados, quantos assinaram um plano. */
export function computeTrialConversion(converted: number, expiredUnsubscribed: number): number | null {
  return percentOf(converted, converted + expiredUnsubscribed);
}

/** Ticket médio do período (pedidos não cancelados); null sem pedidos. */
export function computeTicket(gmv: number, validOrders: number): number | null {
  return validOrders === 0 ? null : gmv / validOrders;
}

/** "2026-10-08" -> "08/10". Formato inesperado volta como veio. */
export function formatDayLabel(date: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[2]}/${match[1]}` : date;
}

/** Pedidos por dia no formato que o gráfico de linha entende. */
export function ordersSeries(days: DayPoint[]): GrowthPoint[] {
  return days.map((day) => ({ month: day.date, total: day.orders }));
}

type Raw = Record<string, unknown>;

function num(value: unknown): number {
  return Number(value ?? 0);
}

export async function getMasterMetrics(supabase: SupabaseClient, days: MetricPeriod): Promise<MasterMetrics> {
  const { data, error } = await supabase.rpc("master_metrics", { p_days: days });
  if (error) throw error;

  const raw = (data ?? {}) as Raw;
  const trial = (raw.trial ?? {}) as Raw;
  const funnel = (raw.funnel ?? {}) as Raw;
  const volume = (raw.volume ?? {}) as Raw;

  return {
    period_days: parsePeriod(String(raw.period_days ?? days)),
    mrr: num(raw.mrr),
    subscribers_active: num(raw.subscribers_active),
    restaurants_active: num(raw.restaurants_active),
    new_restaurants: num(raw.new_restaurants),
    new_restaurants_prev: num(raw.new_restaurants_prev),
    new_with_orders: num(raw.new_with_orders),
    activated_in_period: num(raw.activated_in_period),
    cancellations: num(raw.cancellations),
    trial: {
      started: num(trial.started),
      active_now: num(trial.active_now),
      expiring_7d: num(trial.expiring_7d),
      converted: num(trial.converted),
      expired_unsubscribed: num(trial.expired_unsubscribed),
    },
    funnel: {
      registered: num(funnel.registered),
      onboarding_done: num(funnel.onboarding_done),
      with_products: num(funnel.with_products),
      published: num(funnel.published),
      with_orders: num(funnel.with_orders),
    },
    volume: {
      orders: num(volume.orders),
      valid_orders: num(volume.valid_orders),
      gmv: num(volume.gmv),
      operating_restaurants: num(volume.operating_restaurants),
    },
    orders_by_day: ((raw.orders_by_day ?? []) as Raw[]).map((d) => ({
      date: String(d.date),
      orders: num(d.orders),
      gmv: num(d.gmv),
    })),
    top_restaurants: ((raw.top_restaurants ?? []) as Raw[]).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      slug: String(r.slug),
      plan_name: (r.plan_name as string | null) ?? null,
      orders: num(r.orders),
      gmv: num(r.gmv),
      last_order_at: (r.last_order_at as string | null) ?? null,
    })),
    plans: ((raw.plans ?? []) as Raw[]).map((p) => ({
      plan_id: String(p.plan_id),
      name: String(p.name),
      price: num(p.price),
      is_active: Boolean(p.is_active),
      subscribers: num(p.subscribers),
    })),
  };
}
