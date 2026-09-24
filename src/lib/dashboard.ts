/**
 * Widgets novos do Dashboard (redesign seguindo design-reference/stitch/
 * menunext_dashboard_do_restaurante) — mesmo padrão de computeDashboardMetrics/
 * aggregateCustomers/aggregateBestSellers: fetcher busca as linhas reais de
 * "hoje", funções puras (testáveis sem banco) decidem os cálculos. Nenhuma
 * tabela nova — tudo deriva de orders/order_items/products já existentes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FulfillmentType, OrderStatus, PaymentMethod } from "./orders";
import { getKanbanColumnForStatus } from "./orders";
import { aggregateBestSellers, type BestSellerOrderItemRow, type BestSellerProduct } from "./bestsellers";
import { aggregateCustomers, type CustomerOrderRow } from "./customers";
import { getStartOfDayInTimeZone, SAO_PAULO_TIME_ZONE } from "./timezone";

export type DashboardTodayOrderRow = {
  status: OrderStatus;
  total: number;
  fulfillment_type: FulfillmentType;
  payment_method: PaymentMethod;
  customer_phone: string;
  created_at: string;
  preparing_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
  order_items: BestSellerOrderItemRow[];
};

function minutesBetween(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function validOnly(rows: DashboardTodayOrderRow[]): DashboardTodayOrderRow[] {
  return rows.filter((row) => row.status !== "cancelled");
}

// ---------------------------------------------------------------------------
// Movimento por hora
// ---------------------------------------------------------------------------
export type HourlyMovementPoint = { hour: number; orders: number; revenue: number };

/** Agrupa por hora LOCAL do horário de operação (America/Sao_Paulo), só até
 * a hora atual (não mostra barras futuras vazias do dia). */
export function computeHourlyMovement(todayOrders: DashboardTodayOrderRow[], now: Date = new Date()): HourlyMovementPoint[] {
  const currentHour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "2-digit", hour12: false, timeZone: SAO_PAULO_TIME_ZONE }).format(now)
  );
  const points: HourlyMovementPoint[] = Array.from({ length: currentHour + 1 }, (_, hour) => ({ hour, orders: 0, revenue: 0 }));

  for (const order of validOnly(todayOrders)) {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", { hour: "2-digit", hour12: false, timeZone: SAO_PAULO_TIME_ZONE }).format(
        new Date(order.created_at)
      )
    );
    const point = points[hour];
    if (point) {
      point.orders += 1;
      point.revenue += order.total;
    }
  }

  return points;
}

// ---------------------------------------------------------------------------
// Fila ao vivo (Pedidos agora)
// ---------------------------------------------------------------------------
export type LiveQueue = { novos: number; preparando: number; prontos: number };

/** Recebe só os status dos pedidos ATIVOS (qualquer data, não só hoje —
 * mesmo escopo de `activeOrders` em computeDashboardMetrics) e agrupa pelas
 * 3 primeiras colunas do Kanban operacional (as 2 últimas, Saiu para
 * Entrega/Entregues, não fazem sentido numa fila "agora"). */
export function computeLiveQueue(activeStatuses: OrderStatus[]): LiveQueue {
  const queue: LiveQueue = { novos: 0, preparando: 0, prontos: 0 };
  for (const status of activeStatuses) {
    const column = getKanbanColumnForStatus(status);
    if (column === "novos") queue.novos += 1;
    else if (column === "preparando") queue.preparando += 1;
    else if (column === "prontos") queue.prontos += 1;
  }
  return queue;
}

// ---------------------------------------------------------------------------
// Margem estimada
// ---------------------------------------------------------------------------
export type EstimatedMargin = { revenue: number; cost: number; marginPercent: number };

/** null quando nenhum item vendido hoje tem produto com custo cadastrado —
 * a UI deve mostrar "cadastre o custo dos produtos" em vez de uma margem
 * falsa de 100%. Custo é o CADASTRADO ATUAL do produto (order_items não
 * guarda snapshot de custo) — é uma estimativa, rotulada como tal na UI. */
export function computeEstimatedMargin(
  todayItems: BestSellerOrderItemRow[],
  productCostById: Map<string, number>
): EstimatedMargin | null {
  let revenue = 0;
  let cost = 0;
  let hasAnyCost = false;

  for (const item of todayItems) {
    revenue += item.subtotal;
    const unitCost = item.product_id ? productCostById.get(item.product_id) : undefined;
    if (unitCost !== undefined) {
      hasAnyCost = true;
      cost += unitCost * item.quantity;
    }
  }

  if (!hasAnyCost) return null;
  return { revenue, cost, marginPercent: revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0 };
}

// ---------------------------------------------------------------------------
// Como compraram (canal) / Formas de pagamento / Delivery hoje
// ---------------------------------------------------------------------------
export type ChannelSplit = { delivery: { count: number; revenue: number }; pickup: { count: number; revenue: number } };

export function computeChannelSplit(todayOrders: DashboardTodayOrderRow[]): ChannelSplit {
  const split: ChannelSplit = { delivery: { count: 0, revenue: 0 }, pickup: { count: 0, revenue: 0 } };
  for (const order of validOnly(todayOrders)) {
    split[order.fulfillment_type].count += 1;
    split[order.fulfillment_type].revenue += order.total;
  }
  return split;
}

export type PaymentSplit = Record<PaymentMethod, { count: number; revenue: number }>;

export function computePaymentSplit(todayOrders: DashboardTodayOrderRow[]): PaymentSplit {
  const split: PaymentSplit = {
    pix: { count: 0, revenue: 0 },
    cash: { count: 0, revenue: 0 },
    card: { count: 0, revenue: 0 },
  };
  for (const order of validOnly(todayOrders)) {
    split[order.payment_method].count += 1;
    split[order.payment_method].revenue += order.total;
  }
  return split;
}

export type DeliveryToday = { count: number; revenue: number; averageMinutes: number | null };

export function computeDeliveryToday(todayOrders: DashboardTodayOrderRow[]): DeliveryToday {
  const deliveryOrders = validOnly(todayOrders).filter((o) => o.fulfillment_type === "delivery");
  const deliveredMinutes = deliveryOrders
    .filter((o) => o.status === "delivered" && o.delivered_at)
    .map((o) => minutesBetween(o.created_at, o.delivered_at as string));

  return {
    count: deliveryOrders.length,
    revenue: deliveryOrders.reduce((sum, o) => sum + o.total, 0),
    averageMinutes: average(deliveredMinutes),
  };
}

// ---------------------------------------------------------------------------
// Clientes hoje
// ---------------------------------------------------------------------------
export type CustomersToday = { attended: number; new: number; returning: number };

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** Cruza os telefones que pediram HOJE com o histórico completo (via
 * aggregateCustomers, já buscado do jeito que /painel/clientes já faz) para
 * decidir novo vs. recorrente: "novo" = todo o histórico do telefone é só
 * de hoje; "recorrente" = já tinha pedido válido antes de hoje. */
export function computeCustomersToday(todayOrders: DashboardTodayOrderRow[], allCustomerOrders: CustomerOrderRow[]): CustomersToday {
  const todayPhones = new Set(validOnly(todayOrders).map((o) => normalizePhone(o.customer_phone)));
  if (todayPhones.size === 0) return { attended: 0, new: 0, returning: 0 };

  const customers = aggregateCustomers(allCustomerOrders);
  const customersByPhone = new Map(customers.map((c) => [c.phone, c]));

  let newCount = 0;
  let returningCount = 0;
  for (const phone of todayPhones) {
    const customer = customersByPhone.get(phone);
    const hasOrderBeforeToday = (customer?.numberOfOrders ?? 0) > (validOnly(todayOrders).filter((o) => normalizePhone(o.customer_phone) === phone).length);
    if (hasOrderBeforeToday) returningCount += 1;
    else newCount += 1;
  }

  return { attended: todayPhones.size, new: newCount, returning: returningCount };
}

// ---------------------------------------------------------------------------
// Comparação com ontem
// ---------------------------------------------------------------------------

/** % de variação — null se ontem foi 0 (evita divisão por zero/∞%, a UI
 * mostra "—" nesse caso em vez de um número sem sentido). */
export function computeYesterdayComparison(todayValue: number, yesterdayValue: number): number | null {
  if (yesterdayValue === 0) return null;
  return ((todayValue - yesterdayValue) / yesterdayValue) * 100;
}

// ---------------------------------------------------------------------------
// Insights automáticos ("Hoje no seu restaurante")
// ---------------------------------------------------------------------------
export type DashboardInsight = { label: string; value: string };

/** Puramente descritivo (nunca previsão) — deriva do que já aconteceu hoje.
 * Retorna lista vazia num dia sem pedidos, em vez de insights vazios/falsos. */
export function computeDashboardInsights(
  bestSellersToday: BestSellerProduct[],
  hourlyMovement: HourlyMovementPoint[],
  channelSplit: ChannelSplit
): DashboardInsight[] {
  const insights: DashboardInsight[] = [];

  const topProduct = bestSellersToday[0];
  if (topProduct) {
    insights.push({ label: "Produto destaque", value: `${topProduct.productName} (${topProduct.quantitySold} vendidos hoje)` });
  }

  const peakHour = [...hourlyMovement].sort((a, b) => b.orders - a.orders)[0];
  if (peakHour && peakHour.orders > 0) {
    insights.push({ label: "Horário de maior movimento hoje", value: `${String(peakHour.hour).padStart(2, "0")}h` });
  }

  const { delivery, pickup } = channelSplit;
  const totalChannelOrders = delivery.count + pickup.count;
  if (totalChannelOrders > 0) {
    const strongerChannel = delivery.count >= pickup.count ? "Delivery" : "Retirada";
    const strongerCount = Math.max(delivery.count, pickup.count);
    insights.push({ label: "Canal forte hoje", value: `${strongerChannel} (${Math.round((strongerCount / totalChannelOrders) * 100)}%)` });
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

const TODAY_ORDER_SELECT =
  "status, total, fulfillment_type, payment_method, customer_phone, created_at, preparing_at, ready_at, delivered_at, order_items(product_id, product_name, quantity, subtotal)";

/** Pedidos de HOJE com tudo que os widgets novos precisam — uma única query
 * (nenhum widget novo dispara uma query própria de "hoje"). RLS
 * (orders_select_members) é a proteção real de tenant. */
export async function getTodayOrdersDetailed(supabase: SupabaseClient, restaurantId: string): Promise<DashboardTodayOrderRow[]> {
  const startOfToday = getStartOfDayInTimeZone(new Date(), SAO_PAULO_TIME_ZONE);

  const { data, error } = await supabase
    .from("orders")
    .select(TODAY_ORDER_SELECT)
    .eq("restaurant_id", restaurantId)
    .gte("created_at", startOfToday.toISOString());
  if (error) throw error;

  return ((data ?? []) as DashboardTodayOrderRow[]).map((row) => ({
    ...row,
    total: Number(row.total),
    order_items: row.order_items.map((item) => ({ ...item, quantity: Number(item.quantity), subtotal: Number(item.subtotal) })),
  }));
}

/** Faturamento válido de ONTEM na MESMA janela de horário (meia-noite até
 * "agora menos 24h") — compara hoje-até-agora com o equivalente de ontem, não
 * com o dia inteiro de ontem (senão a manhã sempre pareceria uma queda). */
export async function getYesterdaySameWindowRevenue(supabase: SupabaseClient, restaurantId: string): Promise<{ revenue: number; orders: number }> {
  const startOfToday = getStartOfDayInTimeZone(new Date(), SAO_PAULO_TIME_ZONE);
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
  const sameTimeYesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from("orders")
    .select("status, total")
    .eq("restaurant_id", restaurantId)
    .gte("created_at", startOfYesterday.toISOString())
    .lte("created_at", sameTimeYesterday.toISOString());
  if (error) throw error;

  const rows = (data ?? []) as { status: OrderStatus; total: number }[];
  const valid = rows.filter((row) => row.status !== "cancelled");
  return { revenue: valid.reduce((sum, row) => sum + Number(row.total), 0), orders: rows.length };
}

/** Só os status dos pedidos ativos (qualquer data) — mais leve que
 * getActiveOrdersForKanban (que também traz itens/adicionais, desnecessários
 * para só contar por coluna). */
export async function getActiveOrderStatuses(supabase: SupabaseClient, restaurantId: string): Promise<OrderStatus[]> {
  const { data, error } = await supabase
    .from("orders")
    .select("status")
    .eq("restaurant_id", restaurantId)
    .not("status", "in", "(delivered,picked_up,cancelled)");
  if (error) throw error;
  return ((data ?? []) as { status: OrderStatus }[]).map((row) => row.status);
}

/** Hoje mais vendidos (versão do dia de aggregateBestSellers — o Stitch
 * mostra "Ranking de produtos com maior saída HOJE", diferente do all-time
 * já usado por getBestSellingProducts em outro card). Reaproveita a mesma
 * função pura de bestsellers.ts, só muda o recorte temporal dos dados de
 * entrada — nenhuma lógica de agregação duplicada. */
export function computeBestSellersToday(todayOrders: DashboardTodayOrderRow[], limit = 5): BestSellerProduct[] {
  return aggregateBestSellers(todayOrders, limit);
}
