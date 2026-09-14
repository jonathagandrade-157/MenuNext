/**
 * Ranking de produtos mais vendidos (Sprint 4 — Dashboard) — NUNCA uma
 * tabela nova: agregação pura sobre `order_items` (que já guarda
 * product_id/product_name/quantity/subtotal como snapshot do pedido, ver
 * migration add_public_checkout_and_orders.sql), mesmo padrão de
 * aggregateCustomers (src/lib/customers.ts): fetcher busca as linhas reais,
 * a agregação pura decide o que é "válido" e é testável sem banco.
 *
 * Pedidos cancelados NUNCA entram no ranking (mesma regra de "válido" já
 * usada em customers.ts/orders.ts — não representam venda real). Produtos
 * são agrupados por product_id quando existe; um produto excluído do
 * cardápio depois da venda (product_id fica null pelo "on delete set null")
 * ainda aparece no ranking, agrupado pelo nome congelado em product_name.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderStatus } from "@/lib/orders";

export type BestSellerOrderItemRow = {
  product_id: string | null;
  product_name: string;
  quantity: number;
  subtotal: number;
};

export type BestSellerOrderRow = {
  status: OrderStatus;
  order_items: BestSellerOrderItemRow[];
};

export type BestSellerProduct = {
  productKey: string;
  productName: string;
  quantitySold: number;
  revenue: number;
};

const DEFAULT_LIMIT = 5;

export function aggregateBestSellers(orders: BestSellerOrderRow[], limit = DEFAULT_LIMIT): BestSellerProduct[] {
  const byKey = new Map<string, BestSellerProduct>();

  for (const order of orders) {
    if (order.status === "cancelled") continue;

    for (const item of order.order_items) {
      const key = item.product_id ?? `name:${item.product_name}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.quantitySold += item.quantity;
        existing.revenue += item.subtotal;
      } else {
        byKey.set(key, {
          productKey: key,
          productName: item.product_name,
          quantitySold: item.quantity,
          revenue: item.subtotal,
        });
      }
    }
  }

  return Array.from(byKey.values())
    .sort((a, b) => b.quantitySold - a.quantitySold)
    .slice(0, limit);
}

const BEST_SELLER_SELECT = "status, order_items(product_id, product_name, quantity, subtotal)";

/** RLS (order_items_select_members/orders_select_members) é a proteção real
 * de tenant; o `.eq("restaurant_id", ...)` aqui é defesa em profundidade,
 * mesmo padrão do resto do projeto (ver getCustomerOrders). */
export async function getBestSellingProducts(
  supabase: SupabaseClient,
  restaurantId: string,
  limit = DEFAULT_LIMIT
): Promise<BestSellerProduct[]> {
  const { data, error } = await supabase.from("orders").select(BEST_SELLER_SELECT).eq("restaurant_id", restaurantId);
  if (error) throw error;

  const rows = ((data ?? []) as BestSellerOrderRow[]).map((row) => ({
    ...row,
    order_items: row.order_items.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      subtotal: Number(item.subtotal),
    })),
  }));

  return aggregateBestSellers(rows, limit);
}
