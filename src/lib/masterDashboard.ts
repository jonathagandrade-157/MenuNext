import type { SupabaseClient } from "@supabase/supabase-js";

export type GrowthPoint = { month: string; total: number };
export type PlanStat = { plan_id: string; name: string; price: number; is_active: boolean; subscribers: number };
export type FunnelCounts = {
  registered: number;
  onboarding_done: number;
  with_products: number;
  published: number;
  with_orders: number;
};

export type MasterDashboardStats = {
  restaurants_total: number;
  restaurants_active: number;
  restaurants_new_month: number;
  subscribers_active: number;
  subscribers_pending: number;
  subscribers_overdue: number;
  subscribers_cancelled: number;
  mrr: number;
  trials_active: number;
  trials_expiring_7d: number;
  orders_today: number;
  orders_yesterday: number;
  orders_month: number;
  orders_total: number;
  funnel: FunnelCounts;
  growth: GrowthPoint[];
  plans: PlanStat[];
};

type Raw = Record<string, unknown>;

function num(value: unknown): number {
  return Number(value ?? 0);
}

export async function getMasterDashboardStats(supabase: SupabaseClient): Promise<MasterDashboardStats> {
  const { data, error } = await supabase.rpc("master_dashboard_stats");
  if (error) throw error;

  const raw = (data ?? {}) as Raw;
  const funnel = (raw.funnel ?? {}) as Raw;

  return {
    restaurants_total: num(raw.restaurants_total),
    restaurants_active: num(raw.restaurants_active),
    restaurants_new_month: num(raw.restaurants_new_month),
    subscribers_active: num(raw.subscribers_active),
    subscribers_pending: num(raw.subscribers_pending),
    subscribers_overdue: num(raw.subscribers_overdue),
    subscribers_cancelled: num(raw.subscribers_cancelled),
    mrr: num(raw.mrr),
    trials_active: num(raw.trials_active),
    trials_expiring_7d: num(raw.trials_expiring_7d),
    orders_today: num(raw.orders_today),
    orders_yesterday: num(raw.orders_yesterday),
    orders_month: num(raw.orders_month),
    orders_total: num(raw.orders_total),
    funnel: {
      registered: num(funnel.registered),
      onboarding_done: num(funnel.onboarding_done),
      with_products: num(funnel.with_products),
      published: num(funnel.published),
      with_orders: num(funnel.with_orders),
    },
    growth: ((raw.growth ?? []) as Raw[]).map((p) => ({ month: String(p.month), total: num(p.total) })),
    plans: ((raw.plans ?? []) as Raw[]).map((p) => ({
      plan_id: String(p.plan_id),
      name: String(p.name),
      price: num(p.price),
      is_active: Boolean(p.is_active),
      subscribers: num(p.subscribers),
    })),
  };
}

/** Receita média por assinante em dia; null (nunca 0) sem assinantes. */
export function computeAverageTicket(mrr: number, activeSubscribers: number): number | null {
  if (activeSubscribers === 0) return null;
  return mrr / activeSubscribers;
}

export type MrrRow = PlanStat & { revenue: number; share: number | null };

/** Receita recorrente por plano e participação no total. Só entram planos
 * com assinantes em dia ou ainda à venda; planos desativados e sem
 * assinantes não poluem a lista. `share` é null quando o MRR total é 0. */
export function computeMrrBreakdown(plans: PlanStat[]): { rows: MrrRow[]; total: number } {
  const relevant = plans.filter((plan) => plan.is_active || plan.subscribers > 0);
  const total = relevant.reduce((sum, plan) => sum + plan.price * plan.subscribers, 0);
  const rows = relevant.map((plan) => {
    const revenue = plan.price * plan.subscribers;
    return { ...plan, revenue, share: total === 0 ? null : (revenue / total) * 100 };
  });
  return { rows, total };
}

export type FunnelStep = { id: string; label: string; count: number; percent: number | null };

/** Funil de ativação: cada etapa como % dos restaurantes cadastrados
 * (null, nunca 0%, quando ainda não há cadastros). */
export function buildFunnelSteps(funnel: FunnelCounts): FunnelStep[] {
  const percentOf = (count: number) => (funnel.registered === 0 ? null : (count / funnel.registered) * 100);
  return [
    { id: "registered", label: "Cadastrados", count: funnel.registered },
    { id: "onboarding", label: "Onboarding concluído", count: funnel.onboarding_done },
    { id: "products", label: "Com produtos no cardápio", count: funnel.with_products },
    { id: "published", label: "Loja publicada", count: funnel.published },
    { id: "orders", label: "Com pedidos", count: funnel.with_orders },
  ].map((step) => ({ ...step, percent: percentOf(step.count) }));
}

const MONTH_ABBR = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-09" -> "set/26". Cai no texto original se o formato não bater. */
export function formatMonthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const abbr = MONTH_ABBR[Number(match[2]) - 1];
  return abbr ? `${abbr}/${match[1].slice(2)}` : month;
}

export type ChartGeometry = {
  line: string;
  area: string;
  dots: { x: number; y: number; label: string; value: number }[];
  max: number;
};

/** Coordenadas SVG do gráfico de linha. Eixo Y de 0 até o maior valor (série
 * toda zerada vira uma linha reta na base, sem divisão por zero). */
export function buildGrowthChart(
  points: GrowthPoint[],
  size: { width: number; height: number; padX: number; padY: number }
): ChartGeometry {
  const { width, height, padX, padY } = size;
  const max = Math.max(0, ...points.map((p) => p.total));
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const dots = points.map((point, index) => {
    const x = points.length === 1 ? padX + innerW / 2 : padX + (index / (points.length - 1)) * innerW;
    const y = max === 0 ? padY + innerH : padY + innerH - (point.total / max) * innerH;
    return { x: round(x), y: round(y), label: formatMonthLabel(point.month), value: point.total };
  });

  if (dots.length === 0) return { line: "", area: "", dots, max };

  const line = dots.map((d, i) => `${i === 0 ? "M" : "L"}${d.x},${d.y}`).join(" ");
  const baseline = padY + innerH;
  const area = `${line} L${dots[dots.length - 1].x},${baseline} L${dots[0].x},${baseline} Z`;
  return { line, area, dots, max };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
