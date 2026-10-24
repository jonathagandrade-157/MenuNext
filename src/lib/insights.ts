/**
 * "Insights que agem" — leitura dos últimos dias de vendas que termina numa
 * ação concreta (cupom no horário fraco, ajustar preço, montar combo). Mesmo
 * padrão de dashboard.ts/bestsellers.ts: o fetcher busca as linhas reais e as
 * funções puras decidem os cálculos, testáveis sem banco. Nada é estimado
 * além do que os pedidos mostram; sem dado suficiente, a função devolve
 * vazio/null em vez de inventar um número.
 *
 * Pedidos cancelados nunca contam. Custo é o CADASTRADO ATUAL do produto
 * (order_items não guarda snapshot de custo), por isso a margem é estimativa.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderStatus } from "./orders";
import type { ComboWithItems, Product } from "./tenant";
import { SAO_PAULO_TIME_ZONE } from "./timezone";

export const INSIGHTS_WINDOW_DAYS = 30;
/** Margem bruta abaixo da qual o produto vira alerta. */
export const LOW_MARGIN_THRESHOLD = 0.3;
/** Margem alvo usada para sugerir o preço. */
export const TARGET_MARGIN = 0.35;
/** Pares comprados juntos em menos pedidos que isto são coincidência. */
export const MIN_PAIR_ORDERS = 3;
/** Desconto sugerido no combo. */
export const COMBO_DISCOUNT = 0.1;
/** Pedidos mínimos na janela para falar em horário de pico/fraco. */
export const MIN_ORDERS_FOR_PEAK = 10;

export type InsightOrderItem = {
  product_id: string | null;
  product_name: string;
  quantity: number;
  subtotal: number;
};

export type InsightOrderRow = {
  status: OrderStatus;
  created_at: string;
  order_items: InsightOrderItem[];
};

function valid(orders: InsightOrderRow[]): InsightOrderRow[] {
  return orders.filter((o) => o.status !== "cancelled");
}

// ---------------------------------------------------------------------------
// Horário de pico
// ---------------------------------------------------------------------------
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;

function localHourAndWeekday(iso: string): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SAO_PAULO_TIME_ZONE,
    hour12: false,
    hour: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(iso));
  const hourPart = parts.find((p) => p.type === "hour")?.value ?? "0";
  const weekdayPart = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayPart);
  // Intl formata meia-noite como "24" com hour12: false.
  return { hour: hourPart === "24" ? 0 : Number(hourPart), weekday: Math.max(weekday, 0) };
}

export type PeakInsight = {
  totalOrders: number;
  peakHour: { hour: number; orders: number; sharePercent: number };
  /** Hora com menos pedidos dentro da faixa em que a loja de fato vendeu. */
  slowHour: { hour: number; orders: number } | null;
  peakWeekday: { weekday: string; orders: number };
  byHour: { hour: number; orders: number }[];
};

export function computePeakInsight(orders: InsightOrderRow[]): PeakInsight | null {
  const rows = valid(orders);
  if (rows.length < MIN_ORDERS_FOR_PEAK) return null;

  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0 }));
  const byWeekday = Array.from({ length: 7 }, () => 0);
  for (const row of rows) {
    const { hour, weekday } = localHourAndWeekday(row.created_at);
    byHour[hour].orders += 1;
    byWeekday[weekday] += 1;
  }

  const peak = byHour.reduce((best, h) => (h.orders > best.orders ? h : best), byHour[0]);
  const active = byHour.filter((h) => h.orders > 0);
  const first = active[0].hour;
  const last = active[active.length - 1].hour;
  const inRange = byHour.filter((h) => h.hour >= first && h.hour <= last);
  const slow = inRange.reduce((worst, h) => (h.orders < worst.orders ? h : worst), inRange[0]);
  const peakWeekdayIndex = byWeekday.indexOf(Math.max(...byWeekday));

  return {
    totalOrders: rows.length,
    peakHour: { hour: peak.hour, orders: peak.orders, sharePercent: (peak.orders / rows.length) * 100 },
    slowHour: slow.hour !== peak.hour && slow.orders < peak.orders ? { hour: slow.hour, orders: slow.orders } : null,
    peakWeekday: { weekday: WEEKDAYS[peakWeekdayIndex], orders: byWeekday[peakWeekdayIndex] },
    byHour,
  };
}

// ---------------------------------------------------------------------------
// Produtos com margem baixa
// ---------------------------------------------------------------------------
export type LowMarginProduct = {
  productId: string;
  name: string;
  price: number;
  cost: number;
  marginPercent: number;
  quantitySold: number;
  /** Preço que leva o produto à margem alvo, arredondado para cima em R$ 0,10. */
  suggestedPrice: number;
};

export type MarginInsight = {
  lowMargin: LowMarginProduct[];
  /** Produtos que venderam na janela mas não têm custo cadastrado. */
  soldWithoutCost: number;
};

export function suggestPriceForMargin(cost: number, margin: number = TARGET_MARGIN): number {
  return Math.ceil((cost / (1 - margin)) * 10 - 1e-9) / 10;
}

export function computeMarginInsight(orders: InsightOrderRow[], products: Product[]): MarginInsight {
  const sold = new Map<string, number>();
  for (const order of valid(orders)) {
    for (const item of order.order_items) {
      if (item.product_id) sold.set(item.product_id, (sold.get(item.product_id) ?? 0) + item.quantity);
    }
  }

  const lowMargin: LowMarginProduct[] = [];
  let soldWithoutCost = 0;
  for (const product of products) {
    const quantitySold = sold.get(product.id) ?? 0;
    if (quantitySold === 0) continue;
    if (product.cost === null || product.cost <= 0 || product.price <= 0) {
      if (product.cost === null) soldWithoutCost += 1;
      continue;
    }
    const margin = (product.price - product.cost) / product.price;
    if (margin >= LOW_MARGIN_THRESHOLD) continue;
    lowMargin.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      cost: product.cost,
      marginPercent: margin * 100,
      quantitySold,
      suggestedPrice: suggestPriceForMargin(product.cost),
    });
  }

  // Quem vende mais e rende menos primeiro: é onde o ajuste pesa mais.
  lowMargin.sort((a, b) => b.quantitySold - a.quantitySold);
  return { lowMargin, soldWithoutCost };
}

// ---------------------------------------------------------------------------
// Combos sugeridos por compra em conjunto
// ---------------------------------------------------------------------------
export type ComboSuggestion = {
  productAId: string;
  productAName: string;
  productBId: string;
  productBName: string;
  /** Pedidos em que os dois apareceram juntos. */
  pairOrders: number;
  /** Dos pedidos com o menos pedido dos dois, % que levou o outro junto. */
  togetherPercent: number;
  /** Soma dos preços atuais; null se algum preço é desconhecido. */
  regularPrice: number | null;
  suggestedPrice: number | null;
};

export function computeComboSuggestions(
  orders: InsightOrderRow[],
  products: Product[],
  combos: ComboWithItems[],
  limit = 3
): ComboSuggestion[] {
  const productById = new Map(products.map((p) => [p.id, p]));
  const orderCount = new Map<string, number>();
  const pairCount = new Map<string, number>();

  for (const order of valid(orders)) {
    const ids = Array.from(new Set(order.order_items.map((i) => i.product_id).filter((id): id is string => !!id)));
    for (const id of ids) orderCount.set(id, (orderCount.get(id) ?? 0) + 1);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = [ids[i], ids[j]].sort().join("|");
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      }
    }
  }

  const alreadyCombo = (a: string, b: string) =>
    combos.some((c) => {
      const inCombo = new Set(c.combo_items.map((ci) => ci.product_id));
      return inCombo.has(a) && inCombo.has(b);
    });

  const suggestions: ComboSuggestion[] = [];
  for (const [key, pairOrders] of pairCount) {
    if (pairOrders < MIN_PAIR_ORDERS) continue;
    const [aId, bId] = key.split("|");
    const a = productById.get(aId);
    const b = productById.get(bId);
    // Produto apagado ou indisponível não vira combo.
    if (!a || !b || !a.is_available || !b.is_available) continue;
    if (alreadyCombo(aId, bId)) continue;

    const smaller = Math.min(orderCount.get(aId) ?? 0, orderCount.get(bId) ?? 0);
    const regularPrice = a.price + b.price;
    suggestions.push({
      productAId: aId,
      productAName: a.name,
      productBId: bId,
      productBName: b.name,
      pairOrders,
      togetherPercent: smaller > 0 ? (pairOrders / smaller) * 100 : 0,
      regularPrice,
      suggestedPrice: Math.floor(regularPrice * (1 - COMBO_DISCOUNT) * 10) / 10,
    });
  }

  suggestions.sort((x, y) => y.pairOrders - x.pairOrders || y.togetherPercent - x.togetherPercent);
  return suggestions.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------
const INSIGHT_SELECT = "status, created_at, order_items(product_id, product_name, quantity, subtotal)";
const MAX_ROWS = 5000;

/** RLS é a proteção real de tenant; o eq(restaurant_id) é defesa em
 * profundidade (mesmo padrão de getBestSellingProducts). */
export async function getInsightOrders(
  supabase: SupabaseClient,
  restaurantId: string,
  now: Date = new Date(),
  days = INSIGHTS_WINDOW_DAYS
): Promise<InsightOrderRow[]> {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("orders")
    .select(INSIGHT_SELECT)
    .eq("restaurant_id", restaurantId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw error;

  return ((data ?? []) as InsightOrderRow[]).map((row) => ({
    ...row,
    order_items: row.order_items.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      subtotal: Number(item.subtotal),
    })),
  }));
}
