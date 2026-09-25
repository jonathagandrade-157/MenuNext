/**
 * Clientes do painel (Fase 4.1) — NUNCA uma tabela nova: o cliente aqui é
 * puramente uma agregação de `orders` por telefone (guest checkout não tem
 * conta de cliente, ver create_order/checkout). Agregação pura e testável
 * sem banco (aggregateCustomers), reaproveitando o mesmo padrão de
 * getDashboardOrderMetrics/getSetupChecklist: sem CRM, sem tabela paralela.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FulfillmentType, OrderStatus, PaymentMethod } from "@/lib/orders";
// Import relativo: mesmo motivo documentado em orders.ts — o vitest deste
// projeto não resolve o alias "@/" em runtime, só via tsc (tipo, erasado).
import { getYearMonthInTimeZone, SAO_PAULO_TIME_ZONE } from "./timezone";

export type CustomerOrderRow = {
  id: string;
  order_number: number;
  customer_name: string;
  customer_phone: string;
  status: OrderStatus;
  fulfillment_type: FulfillmentType;
  payment_method: PaymentMethod;
  total: number;
  created_at: string;
  delivery_street: string | null;
  delivery_number: string | null;
  delivery_complement: string | null;
  delivery_neighborhood: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
};

export type CustomerOrderSummary = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  total: number;
  createdAt: string;
};

export type CustomerSummary = {
  phone: string;
  name: string;
  numberOfOrders: number;
  totalSpent: number;
  averageTicket: number;
  lastOrderAt: string;
  addresses: string[];
  orders: CustomerOrderSummary[];
};

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function formatAddress(row: CustomerOrderRow): string | null {
  if (!row.delivery_street || !row.delivery_number) return null;
  const complement = row.delivery_complement ? ` - ${row.delivery_complement}` : "";
  const neighborhood = row.delivery_neighborhood ? `, ${row.delivery_neighborhood}` : "";
  const city = row.delivery_city ? ` — ${row.delivery_city}` : "";
  const state = row.delivery_state ? `/${row.delivery_state}` : "";
  return `${row.delivery_street}, ${row.delivery_number}${complement}${neighborhood}${city}${state}`;
}

/**
 * Agrega pedidos por cliente (telefone normalizado — mesmo dado usado como
 * identidade do cliente no checkout guest). Pedidos cancelados contam para
 * o histórico exibido, mas NUNCA entram em número de pedidos/total
 * gasto/ticket médio (não representam receita real). Nome e endereços usam
 * sempre o pedido mais recente de cada cliente (dado pode mudar entre
 * pedidos — não há um cadastro único de cliente para "corrigir" isso).
 */
export function aggregateCustomers(orders: CustomerOrderRow[]): CustomerSummary[] {
  const byPhone = new Map<string, CustomerOrderRow[]>();

  for (const order of orders) {
    const phone = normalizePhone(order.customer_phone);
    const list = byPhone.get(phone) ?? [];
    list.push(order);
    byPhone.set(phone, list);
  }

  const summaries: CustomerSummary[] = [];

  for (const [phone, customerOrders] of byPhone) {
    const sorted = [...customerOrders].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const validOrders = sorted.filter((o) => o.status !== "cancelled");
    const totalSpent = validOrders.reduce((sum, o) => sum + o.total, 0);

    const addresses = Array.from(
      new Set(sorted.map(formatAddress).filter((address): address is string => address !== null))
    );

    summaries.push({
      phone,
      name: sorted[0].customer_name,
      numberOfOrders: validOrders.length,
      totalSpent,
      averageTicket: validOrders.length > 0 ? totalSpent / validOrders.length : 0,
      lastOrderAt: sorted[0].created_at,
      addresses,
      orders: sorted.map((o) => ({ id: o.id, orderNumber: o.order_number, status: o.status, total: o.total, createdAt: o.created_at })),
    });
  }

  return summaries.sort((a, b) => new Date(b.lastOrderAt).getTime() - new Date(a.lastOrderAt).getTime());
}

const CUSTOMER_ORDER_SELECT =
  "id, order_number, customer_name, customer_phone, status, fulfillment_type, payment_method, total, created_at, delivery_street, delivery_number, delivery_complement, delivery_neighborhood, delivery_city, delivery_state";

/** Todos os pedidos do restaurante, só as colunas necessárias para agregar
 * clientes (sem itens/adicionais — mais leve que getOrderHistory, que serve
 * a um propósito diferente). RLS (orders_select_members) é a proteção real. */
export async function getCustomerOrders(supabase: SupabaseClient, restaurantId: string): Promise<CustomerOrderRow[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(CUSTOMER_ORDER_SELECT)
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as CustomerOrderRow[]).map((row) => ({ ...row, total: Number(row.total) }));
}

// ============================================================
// Segmentação e estatísticas (área "Clientes" do redesign) — puras,
// derivadas só de CustomerSummary, nenhum dado novo.
// ============================================================

export type CustomerSegment = "recorrente" | "novo" | "inativo";

/** Sem pedido válido há esse tanto de dias = "inativo" nas abas de Clientes.
 * Limiar de negócio (não um dado real), escolhido com o usuário — 60 dias
 * (2 meses) para o exemplo de restaurante de delivery/retirada deste
 * produto. Ajustável aqui se a definição mudar. */
const INACTIVE_DAYS_THRESHOLD = 60;

/** Segmentos de um cliente para as abas de Clientes — não particionam a
 * base (um cliente pode não cair em nenhum, ex.: 1 pedido há 20 dias) nem
 * são exclusivos entre si (um cliente pode ser "novo" — 1º pedido neste
 * mês — mas nunca "novo" e "recorrente" ao mesmo tempo, pois recorrente
 * exige 2+ pedidos). "Recorrente" = 2+ pedidos válidos (nunca conta
 * cancelado, mesma regra de numberOfOrders). "Novo" = o pedido mais antigo
 * do cliente caiu no mês civil corrente (fuso de São Paulo, mesmo padrão de
 * getStartOfDayInTimeZone). "Inativo" = nenhum pedido há
 * INACTIVE_DAYS_THRESHOLD dias ou mais. */
export function getCustomerSegments(customer: CustomerSummary, now: Date): CustomerSegment[] {
  const segments: CustomerSegment[] = [];

  if (customer.numberOfOrders >= 2) segments.push("recorrente");

  const firstOrderAt = new Date(customer.orders[customer.orders.length - 1].createdAt);
  const firstOrderMonth = getYearMonthInTimeZone(firstOrderAt, SAO_PAULO_TIME_ZONE);
  const nowMonth = getYearMonthInTimeZone(now, SAO_PAULO_TIME_ZONE);
  if (customer.numberOfOrders < 2 && firstOrderMonth.year === nowMonth.year && firstOrderMonth.month === nowMonth.month) {
    segments.push("novo");
  }

  const daysSinceLastOrder = (now.getTime() - new Date(customer.lastOrderAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceLastOrder >= INACTIVE_DAYS_THRESHOLD) segments.push("inativo");

  return segments;
}

export type CustomerStats = {
  totalCustomers: number;
  newThisMonth: number;
  recurring: number;
  recurringPercent: number;
  averageTicket: number;
  totalOrders: number;
};

/** Estatísticas do topo da tela de Clientes — agregação sobre
 * CustomerSummary[], nenhuma query nova. Ticket médio é o real (receita
 * total / pedidos totais), não a média das médias por cliente. */
export function computeCustomerStats(customers: CustomerSummary[], now: Date): CustomerStats {
  let newThisMonth = 0;
  let recurring = 0;
  let totalOrders = 0;
  let totalRevenue = 0;

  for (const customer of customers) {
    const segments = getCustomerSegments(customer, now);
    if (segments.includes("novo")) newThisMonth++;
    if (segments.includes("recorrente")) recurring++;
    totalOrders += customer.numberOfOrders;
    totalRevenue += customer.totalSpent;
  }

  return {
    totalCustomers: customers.length,
    newThisMonth,
    recurring,
    recurringPercent: customers.length > 0 ? (recurring / customers.length) * 100 : 0,
    averageTicket: totalOrders > 0 ? totalRevenue / totalOrders : 0,
    totalOrders,
  };
}

// ============================================================
// Notas internas (área "Clientes" do redesign) — feature nova, visível só
// para a equipe do restaurante (nunca para o cliente). Log de anotações
// (insert-only, sem edição/exclusão) por telefone normalizado, não um
// cadastro de cliente: mesma filosofia de aggregateCustomers, o cliente
// continua sendo só uma agregação de pedidos.
// ============================================================

export type CustomerNote = {
  id: string;
  customer_phone: string;
  note: string;
  created_at: string;
};

const CUSTOMER_NOTE_SELECT = "id, customer_phone, note, created_at";

/** Todas as notas do restaurante, agrupadas por telefone normalizado —
 * mesmo padrão de getCategoryProductCounts (um Record em vez de uma query
 * por cliente). RLS (customer_notes_select_owner) é a proteção real. */
export async function getCustomerNotesByPhone(
  supabase: SupabaseClient,
  restaurantId: string
): Promise<Record<string, CustomerNote[]>> {
  const { data, error } = await supabase
    .from("customer_notes")
    .select(CUSTOMER_NOTE_SELECT)
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const byPhone: Record<string, CustomerNote[]> = {};
  for (const row of (data ?? []) as CustomerNote[]) {
    const list = byPhone[row.customer_phone] ?? [];
    list.push(row);
    byPhone[row.customer_phone] = list;
  }
  return byPhone;
}
