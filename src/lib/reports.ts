import type { SupabaseClient } from "@supabase/supabase-js";
import type { FulfillmentType, OrderStatus, PaymentMethod } from "./orders";
import { SAO_PAULO_TIME_ZONE } from "./timezone";

/**
 * Relatórios de vendas (somente leitura, OWNER). Mesmo padrão de insights.ts: o fetcher lê as linhas reais (RLS é a
 * proteção de tenant; o eq(restaurant_id) é defesa em profundidade) e funções puras fazem as contas.
 *
 * Definições (mostradas na tela): "venda" = pedido NÃO cancelado; "faturamento" = soma de `total` desses pedidos
 * (inclui frete, desconta cupom/promoção); o sistema NÃO confirma o recebimento do Pix, então faturamento é o valor
 * vendido, não o valor conciliado em banco.
 */
export const MAX_RANGE_DAYS = 366;
export const MAX_REPORT_ROWS = 10_000;
const PAGE_SIZE = 1000;
// O Brasil não tem horário de verão desde 2019; o app usa America/Sao_Paulo fixo (ver timezone.ts).
const SP_OFFSET = "-03:00";

export type ReportPeriod = { from: string; to: string; startIso: string; endIso: string; days: number };
export type PeriodResult = { ok: true; period: ReportPeriod } | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function localDateString(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: SAO_PAULO_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return parts; // en-CA => YYYY-MM-DD
}

/** Período [from, to] inclusivo, em datas de São Paulo. Sem parâmetros: últimos 30 dias até hoje. */
export function parseReportPeriod(rawFrom: unknown, rawTo: unknown, now: Date = new Date()): PeriodResult {
  const today = localDateString(now);
  const to = typeof rawTo === "string" && rawTo ? rawTo : today;
  let from: string;
  if (typeof rawFrom === "string" && rawFrom) from = rawFrom;
  else from = localDateString(new Date(new Date(`${to}T12:00:00${SP_OFFSET}`).getTime() - 29 * 86_400_000));
  if (!isRealDate(from) || !isRealDate(to)) return { ok: false, error: "Datas inválidas. Use o formato AAAA-MM-DD." };
  if (from > to) return { ok: false, error: "A data inicial não pode ser depois da final." };
  if (to > today) return { ok: false, error: "A data final não pode estar no futuro." };
  const start = new Date(`${from}T00:00:00${SP_OFFSET}`);
  const end = new Date(new Date(`${to}T00:00:00${SP_OFFSET}`).getTime() + 86_400_000);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (days > MAX_RANGE_DAYS) return { ok: false, error: `O período máximo é de ${MAX_RANGE_DAYS} dias.` };
  return { ok: true, period: { from, to, startIso: start.toISOString(), endIso: end.toISOString(), days } };
}

export type ReportOrderItem = { product_name: string; quantity: number; subtotal: number };
export type ReportOrder = {
  order_number: number;
  created_at: string;
  status: OrderStatus;
  fulfillment_type: FulfillmentType;
  payment_method: PaymentMethod;
  subtotal: number;
  discount_amount: number;
  delivery_fee: number;
  total: number;
  order_items: ReportOrderItem[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export type SalesReport = {
  orders: number;
  cancelled: number;
  cancelRate: number;
  revenue: number;
  averageTicket: number;
  discounts: number;
  deliveryFees: number;
  byPayment: Record<PaymentMethod, { orders: number; revenue: number }>;
  byFulfillment: Record<FulfillmentType, { orders: number; revenue: number }>;
  daily: { date: string; orders: number; revenue: number }[];
  topProducts: { name: string; quantity: number; revenue: number }[];
};

export function computeSalesReport(rows: ReportOrder[], topLimit = 10): SalesReport {
  const sold = rows.filter((r) => r.status !== "cancelled");
  const cancelled = rows.length - sold.length;
  const byPayment = { pix: { orders: 0, revenue: 0 }, cash: { orders: 0, revenue: 0 }, card: { orders: 0, revenue: 0 } };
  const byFulfillment = { delivery: { orders: 0, revenue: 0 }, pickup: { orders: 0, revenue: 0 }, counter: { orders: 0, revenue: 0 } };
  const days = new Map<string, { orders: number; revenue: number }>();
  const products = new Map<string, { quantity: number; revenue: number }>();
  let revenue = 0;
  let discounts = 0;
  let deliveryFees = 0;

  for (const o of sold) {
    const total = Number(o.total);
    revenue += total;
    discounts += Number(o.discount_amount);
    deliveryFees += Number(o.delivery_fee);
    if (byPayment[o.payment_method]) {
      byPayment[o.payment_method].orders += 1;
      byPayment[o.payment_method].revenue += total;
    }
    if (byFulfillment[o.fulfillment_type]) {
      byFulfillment[o.fulfillment_type].orders += 1;
      byFulfillment[o.fulfillment_type].revenue += total;
    }
    const day = localDateString(new Date(o.created_at));
    const d = days.get(day) ?? { orders: 0, revenue: 0 };
    d.orders += 1;
    d.revenue += total;
    days.set(day, d);
    for (const item of o.order_items ?? []) {
      const p = products.get(item.product_name) ?? { quantity: 0, revenue: 0 };
      p.quantity += Number(item.quantity);
      p.revenue += Number(item.subtotal);
      products.set(item.product_name, p);
    }
  }

  for (const v of [...Object.values(byPayment), ...Object.values(byFulfillment)]) v.revenue = round2(v.revenue);
  return {
    orders: sold.length,
    cancelled,
    cancelRate: rows.length ? cancelled / rows.length : 0,
    revenue: round2(revenue),
    averageTicket: sold.length ? round2(revenue / sold.length) : 0,
    discounts: round2(discounts),
    deliveryFees: round2(deliveryFees),
    byPayment,
    byFulfillment,
    daily: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, orders: v.orders, revenue: round2(v.revenue) })),
    topProducts: [...products.entries()]
      .map(([name, v]) => ({ name, quantity: v.quantity, revenue: round2(v.revenue) }))
      .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue || a.name.localeCompare(b.name, "pt-BR"))
      .slice(0, topLimit),
  };
}

// ---------------------------------------------------------------------------
// CSV (Excel pt-BR: separador ";", decimal com vírgula, BOM UTF-8)
// ---------------------------------------------------------------------------
/** Neutraliza injeção de fórmula (=, +, -, @, tab, CR no início) e aplica aspas. */
export function csvCell(value: string | number): string {
  let text = typeof value === "number" ? String(value).replace(".", ",") : value;
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  received: "Recebido", confirmed: "Confirmado", preparing: "Preparando", ready: "Pronto",
  out_for_delivery: "Saiu para entrega", delivered: "Entregue", picked_up: "Retirado", cancelled: "Cancelado",
};
const FULFILLMENT_LABEL: Record<FulfillmentType, string> = { delivery: "Entrega", pickup: "Retirada", counter: "Balcão" };
const PAYMENT_LABEL: Record<PaymentMethod, string> = { pix: "Pix", cash: "Dinheiro", card: "Cartão" };

/** Uma linha por pedido. Sem nome nem telefone do cliente de propósito (minimização de dados pessoais). */
export function ordersToCsv(rows: ReportOrder[]): string {
  const header = ["Pedido", "Data", "Hora", "Status", "Tipo", "Pagamento", "Subtotal", "Desconto", "Taxa de entrega", "Total", "Itens"];
  const lines = [header.map(csvCell).join(";")];
  for (const o of rows) {
    const when = new Date(o.created_at);
    const date = localDateString(when);
    const time = new Intl.DateTimeFormat("pt-BR", { timeZone: SAO_PAULO_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(when);
    const items = (o.order_items ?? []).map((i) => `${i.quantity}x ${i.product_name}`).join(" | ");
    const money = (n: number) => Number(n).toFixed(2).replace(".", ",");
    lines.push(
      [
        String(o.order_number), date, time, STATUS_LABEL[o.status] ?? o.status, FULFILLMENT_LABEL[o.fulfillment_type] ?? o.fulfillment_type,
        PAYMENT_LABEL[o.payment_method] ?? o.payment_method,
        money(o.subtotal), money(o.discount_amount), money(o.delivery_fee), money(o.total), items,
      ]
        .map(csvCell)
        .join(";"),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

const SELECT =
  "order_number, created_at, status, fulfillment_type, payment_method, subtotal, discount_amount, delivery_fee, total, order_items(product_name, quantity, subtotal)";

export type ReportData = { rows: ReportOrder[]; truncated: boolean };

export async function getReportOrders(supabase: SupabaseClient, restaurantId: string, period: ReportPeriod): Promise<ReportData> {
  const rows: ReportOrder[] = [];
  for (let offset = 0; offset < MAX_REPORT_ROWS; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("orders")
      .select(SELECT)
      .eq("restaurant_id", restaurantId)
      .gte("created_at", period.startIso)
      .lt("created_at", period.endIso)
      .order("created_at", { ascending: true })
      .order("order_number", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as ReportOrder[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}
