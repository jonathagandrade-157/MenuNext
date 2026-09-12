/**
 * Clientes do painel (Fase 4.1) — NUNCA uma tabela nova: o cliente aqui é
 * puramente uma agregação de `orders` por telefone (guest checkout não tem
 * conta de cliente, ver create_order/checkout). Agregação pura e testável
 * sem banco (aggregateCustomers), reaproveitando o mesmo padrão de
 * getDashboardOrderMetrics/getSetupChecklist: sem CRM, sem tabela paralela.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FulfillmentType, OrderStatus, PaymentMethod } from "@/lib/orders";

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
