/**
 * Camada de pedidos do painel (Fase 3.4) — máquina de estados PURA (testável
 * sem banco, espelha exatamente a lógica de public.advance_order_status na
 * migration add_order_status_transitions.sql — nunca a fonte de verdade,
 * que é sempre o servidor) e o fetcher que lê orders/order_items/
 * order_item_addons reais (RLS "orders_select_members" já garante que só
 * pedidos do próprio restaurante voltam).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type OrderStatus =
  | "received"
  | "confirmed"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "delivered"
  | "picked_up"
  | "cancelled";

export type FulfillmentType = "delivery" | "pickup";
export type PaymentMethod = "pix" | "cash" | "card";

/** Mesma sequência da RPC advance_order_status — única fonte de verdade
 * sobre "qual é o próximo passo", replicada aqui só para a UI saber o que
 * mostrar no botão (o servidor recalcula tudo de novo, nunca confia nisto). */
export const DELIVERY_FLOW: OrderStatus[] = ["received", "confirmed", "preparing", "ready", "out_for_delivery", "delivered"];
export const PICKUP_FLOW: OrderStatus[] = ["received", "confirmed", "preparing", "ready", "picked_up"];

export function getOrderFlow(fulfillmentType: FulfillmentType): OrderStatus[] {
  return fulfillmentType === "delivery" ? DELIVERY_FLOW : PICKUP_FLOW;
}

/** Próximo status na esteira, ou null se o pedido já está num estado terminal
 * (delivered/picked_up) ou cancelado — mesma regra da RPC. */
export function getNextOrderStatus(status: OrderStatus, fulfillmentType: FulfillmentType): OrderStatus | null {
  const flow = getOrderFlow(fulfillmentType);
  const index = flow.indexOf(status);
  if (index === -1 || index === flow.length - 1) return null;
  return flow[index + 1];
}

export function isTerminalOrderStatus(status: OrderStatus, fulfillmentType: FulfillmentType): boolean {
  return status === "cancelled" || getNextOrderStatus(status, fulfillmentType) === null;
}

/** Rótulo do botão de quick action — chaveado pelo status DE DESTINO (cada
 * status de destino só é alcançável por um fluxo, então não precisa saber
 * fulfillment_type aqui). */
export const ORDER_STATUS_ACTION_LABEL: Record<OrderStatus, string> = {
  received: "",
  confirmed: "Confirmar pedido",
  preparing: "Iniciar preparo",
  ready: "Marcar como pronto",
  out_for_delivery: "Saiu para entrega",
  delivered: "Marcar como entregue",
  picked_up: "Marcar como retirado",
  cancelled: "",
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  received: "Recebido",
  confirmed: "Confirmado",
  preparing: "Em preparo",
  ready: "Pronto",
  out_for_delivery: "Saiu para entrega",
  delivered: "Entregue",
  picked_up: "Retirado",
  cancelled: "Cancelado",
};

/** As 5 colunas operacionais do Kanban (item 11 do prompt da Fase 3.4).
 * "Novos" agrupa received+confirmed (confirmar é uma ação rápida dentro da
 * mesma coluna, não uma coluna própria); "Saiu para entrega" só recebe
 * pedidos de delivery — retirada pula direto de "Prontos" para "Entregues"
 * (picked_up), o que é esperado e correto. */
export type KanbanColumnId = "novos" | "preparando" | "prontos" | "saiu_para_entrega" | "entregues";

export const KANBAN_COLUMNS: { id: KanbanColumnId; title: string; statuses: OrderStatus[] }[] = [
  { id: "novos", title: "Novos", statuses: ["received", "confirmed"] },
  { id: "preparando", title: "Em Preparação", statuses: ["preparing"] },
  { id: "prontos", title: "Prontos", statuses: ["ready"] },
  { id: "saiu_para_entrega", title: "Saiu para Entrega", statuses: ["out_for_delivery"] },
  { id: "entregues", title: "Entregues", statuses: ["delivered", "picked_up"] },
];

export function getKanbanColumnForStatus(status: OrderStatus): KanbanColumnId | null {
  const column = KANBAN_COLUMNS.find((c) => c.statuses.includes(status));
  return column?.id ?? null;
}

/** Motivos de cancelamento oferecidos ao lojista (Fase 4.1) — lista fechada
 * exceto "other", que exige um texto livre complementar. O motivo final
 * enviado à RPC cancel_order é sempre uma string (o rótulo, para "other" o
 * texto digitado), gravada em order_status_history.reason. */
export const CANCEL_REASONS = [
  { value: "customer_cancelled", label: "Cliente cancelou" },
  { value: "product_unavailable", label: "Produto indisponível" },
  { value: "cannot_fulfill", label: "Restaurante não consegue atender" },
  { value: "invalid_address", label: "Endereço inválido" },
  { value: "other", label: "Outro" },
] as const;

export type CancelReasonValue = (typeof CANCEL_REASONS)[number]["value"];

/** Nome do canal de broadcast do tracking público deste pedido — o
 * public_id (UUID não adivinhável) é a própria autorização, mesmo modelo
 * de confiança que get_public_order já usa (ver migration
 * add_order_status_transitions.sql, seção 4). */
export function orderTrackingChannelName(publicId: string): string {
  return `order-tracking:${publicId}`;
}

export type OrderItemAddon = {
  id: string;
  addon_name: string;
  unit_price: number;
  subtotal: number;
};

export type OrderItem = {
  id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  observation: string | null;
  subtotal: number;
  order_item_addons: OrderItemAddon[];
};

export type Order = {
  id: string;
  restaurant_id: string;
  public_id: string;
  order_number: number;
  customer_name: string;
  customer_phone: string;
  fulfillment_type: FulfillmentType;
  delivery_zip: string | null;
  delivery_street: string | null;
  delivery_number: string | null;
  delivery_complement: string | null;
  delivery_neighborhood: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  delivery_reference: string | null;
  payment_method: PaymentMethod;
  change_for: number | null;
  observation: string | null;
  subtotal: number;
  delivery_fee: number;
  total: number;
  status: OrderStatus;
  confirmed_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  out_for_delivery_at: string | null;
  delivered_at: string | null;
  picked_up_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderWithItems = Order & { order_items: OrderItem[] };

const ORDER_WITH_ITEMS_SELECT = "*, order_items(*, order_item_addons(*))";

/** Normaliza os campos numéricos de um pedido (numeric chega como string do
 * PostgREST e, no payload de postgres_changes do Realtime, pode chegar como
 * string ou number dependendo da coluna — Number() é seguro nos dois
 * casos). Exportado para o KanbanBoard reaproveitar ao tratar eventos
 * realtime, em vez de duplicar a conversão. */
export function normalizeOrderFields<T extends Record<string, unknown>>(row: T): T {
  return {
    ...row,
    subtotal: Number(row.subtotal),
    delivery_fee: Number(row.delivery_fee),
    total: Number(row.total),
    change_for: row.change_for === null ? null : Number(row.change_for),
  };
}

function normalizeOrderWithItems(row: OrderWithItems): OrderWithItems {
  return {
    ...normalizeOrderFields(row),
    order_items: (row.order_items ?? [])
      .map((item) => ({
        ...item,
        unit_price: Number(item.unit_price),
        subtotal: Number(item.subtotal),
        order_item_addons: (item.order_item_addons ?? [])
          .map((addon) => ({ ...addon, unit_price: Number(addon.unit_price), subtotal: Number(addon.subtotal) })),
      }))
      .sort((a, b) => a.product_name.localeCompare(b.product_name)),
  };
}

/**
 * Pedidos ATIVOS (ainda não concluídos/cancelados) do restaurante, com
 * itens e adicionais já embutidos numa única query (evita N+1 — mesmo
 * padrão de getPublicProductDetail/getCombosWithItems em src/lib/store.ts).
 * RLS (orders_select_members) já garante isolamento por restaurante; o
 * `.eq("restaurant_id", ...)` aqui é só para não puxar linhas à toa, a
 * proteção real é a policy.
 */
export async function getActiveOrdersForKanban(supabase: SupabaseClient, restaurantId: string): Promise<OrderWithItems[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_WITH_ITEMS_SELECT)
    .eq("restaurant_id", restaurantId)
    .not("status", "in", "(delivered,picked_up,cancelled)")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as OrderWithItems[]).map(normalizeOrderWithItems);
}

/**
 * Histórico de pedidos do restaurante (Fase 4.1) — TODOS os status, mais
 * recentes primeiro, limitado a um teto razoável para uma tela de operação
 * (filtros de período/status/cliente/valor são aplicados no client sobre
 * este conjunto, sem nova query por filtro — mesmo padrão de simplicidade
 * de getSetupChecklist: nenhuma tabela/índice novo só para isto). RLS
 * (orders_select_members) é, de novo, a única proteção real de tenant.
 */
const ORDER_HISTORY_LIMIT = 300;

export async function getOrderHistory(supabase: SupabaseClient, restaurantId: string): Promise<OrderWithItems[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_WITH_ITEMS_SELECT)
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false })
    .limit(ORDER_HISTORY_LIMIT);
  if (error) throw error;
  return ((data ?? []) as OrderWithItems[]).map(normalizeOrderWithItems);
}

/** Grupos de status usados pelas abas do histórico de pedidos — únicos o
 * suficiente para responder rápido "o que está em qual etapa", sem replicar
 * 1-status-por-aba (que forçaria o lojista a abrir 8 abas para achar algo). */
export type OrderHistoryTabId = "all" | "received" | "preparing" | "out_for_delivery" | "delivered" | "cancelled";

export const ORDER_HISTORY_TABS: { id: OrderHistoryTabId; title: string; statuses: OrderStatus[] | null }[] = [
  { id: "all", title: "Todos", statuses: null },
  { id: "received", title: "Recebidos", statuses: ["received", "confirmed"] },
  { id: "preparing", title: "Em preparação", statuses: ["preparing", "ready"] },
  { id: "out_for_delivery", title: "Saiu para entrega", statuses: ["out_for_delivery"] },
  { id: "delivered", title: "Entregues", statuses: ["delivered", "picked_up"] },
  { id: "cancelled", title: "Cancelados", statuses: ["cancelled"] },
];

export function formatOrderDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Um pedido específico com itens — usado para buscar o pedido recém-criado
 * quando o Kanban recebe um evento realtime de INSERT (que só traz as
 * colunas de `orders`, sem os itens). */
export async function getOrderWithItems(supabase: SupabaseClient, orderId: string): Promise<OrderWithItems | null> {
  const { data, error } = await supabase.from("orders").select(ORDER_WITH_ITEMS_SELECT).eq("id", orderId).maybeSingle();
  if (error) throw error;
  return data ? normalizeOrderWithItems(data as OrderWithItems) : null;
}

export type DashboardOrderMetrics = {
  ordersToday: number;
  revenueToday: number;
  averageTicketToday: number;
  activeOrders: number;
  deliveredToday: number;
  cancelledToday: number;
  averagePrepMinutes: number | null;
  averageDeliveryMinutes: number | null;
};

function minutesBetween(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Métricas básicas do Dashboard (item 22 da Fase 3.4, ampliadas na Fase
 * 4.1 com entregues/cancelados hoje e tempos médios) — derivadas
 * diretamente de `orders`, nunca de uma tabela paralela. "Hoje" usa a data
 * local do servidor (mesma limitação já existente no projeto — nenhuma
 * tabela guarda timezone do restaurante, ver computeStoreOpenState em
 * src/lib/store.ts). "Pedidos ativos" conta qualquer pedido fora dos
 * status terminais, independente da data. Tempo médio de preparo usa
 * preparing_at -> ready_at; tempo médio até entrega usa created_at ->
 * delivered_at — ambos só sobre pedidos de hoje que já têm os dois
 * timestamps preenchidos (null quando não há nenhum pedido nessa condição
 * ainda hoje, nunca 0 — 0 minutos seria um dado errado, não "sem dado").
 */
export async function getDashboardOrderMetrics(supabase: SupabaseClient, restaurantId: string): Promise<DashboardOrderMetrics> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [todayResult, activeResult] = await Promise.all([
    supabase
      .from("orders")
      .select("total, status, created_at, preparing_at, ready_at, delivered_at")
      .eq("restaurant_id", restaurantId)
      .gte("created_at", startOfToday.toISOString()),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .not("status", "in", "(delivered,picked_up,cancelled)"),
  ]);

  if (todayResult.error) throw todayResult.error;
  if (activeResult.error) throw activeResult.error;

  const todayOrders = todayResult.data ?? [];
  const revenueToday = todayOrders.reduce((sum, row) => sum + Number(row.total), 0);

  const prepMinutes = todayOrders
    .filter((row) => row.preparing_at && row.ready_at)
    .map((row) => minutesBetween(row.preparing_at as string, row.ready_at as string));

  const deliveryMinutes = todayOrders
    .filter((row) => row.status === "delivered" && row.delivered_at)
    .map((row) => minutesBetween(row.created_at, row.delivered_at as string));

  return {
    ordersToday: todayOrders.length,
    revenueToday,
    averageTicketToday: todayOrders.length > 0 ? revenueToday / todayOrders.length : 0,
    activeOrders: activeResult.count ?? 0,
    deliveredToday: todayOrders.filter((row) => row.status === "delivered" || row.status === "picked_up").length,
    cancelledToday: todayOrders.filter((row) => row.status === "cancelled").length,
    averagePrepMinutes: average(prepMinutes),
    averageDeliveryMinutes: average(deliveryMinutes),
  };
}

export function formatCurrencyBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatOrderTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
