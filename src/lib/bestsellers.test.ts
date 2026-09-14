import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aggregateBestSellers, getBestSellingProducts, type BestSellerOrderRow } from "./bestsellers";

/** Mesmo fake mínimo do query builder usado em orders.test.ts, para provar
 * isolamento por restaurante sem precisar de um banco real. */
function createFakeSupabase(rows: unknown[]) {
  const calls: { method: string; args: unknown[] }[] = [];
  const query = {
    select: (...args: unknown[]) => {
      calls.push({ method: "select", args });
      return query;
    },
    eq: (...args: unknown[]) => {
      calls.push({ method: "eq", args });
      return query;
    },
    then: (resolve: (value: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null }),
  };
  const client = {
    from: (table: string) => {
      calls.push({ method: "from", args: [table] });
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

function order(status: BestSellerOrderRow["status"], items: BestSellerOrderRow["order_items"]): BestSellerOrderRow {
  return { status, order_items: items };
}

describe("aggregateBestSellers", () => {
  it("soma quantidade e faturamento do mesmo produto em pedidos diferentes", () => {
    const orders = [
      order("delivered", [{ product_id: "p1", product_name: "X-Burger", quantity: 2, subtotal: 40 }]),
      order("preparing", [{ product_id: "p1", product_name: "X-Burger", quantity: 1, subtotal: 20 }]),
    ];
    const result = aggregateBestSellers(orders);
    expect(result).toEqual([{ productKey: "p1", productName: "X-Burger", quantitySold: 3, revenue: 60 }]);
  });

  it("BUG-LIKE: pedidos cancelados nunca entram no ranking", () => {
    const orders = [
      order("cancelled", [{ product_id: "p1", product_name: "X-Burger", quantity: 10, subtotal: 200 }]),
      order("delivered", [{ product_id: "p2", product_name: "Batata Frita", quantity: 1, subtotal: 15 }]),
    ];
    const result = aggregateBestSellers(orders);
    expect(result).toEqual([{ productKey: "p2", productName: "Batata Frita", quantitySold: 1, revenue: 15 }]);
  });

  it("produto excluído do cardápio (product_id null) ainda agrega pelo nome congelado", () => {
    const orders = [
      order("delivered", [{ product_id: null, product_name: "Combo Antigo", quantity: 2, subtotal: 50 }]),
      order("delivered", [{ product_id: null, product_name: "Combo Antigo", quantity: 1, subtotal: 25 }]),
    ];
    const result = aggregateBestSellers(orders);
    expect(result).toEqual([{ productKey: "name:Combo Antigo", productName: "Combo Antigo", quantitySold: 3, revenue: 75 }]);
  });

  it("ordena por quantidade vendida, decrescente", () => {
    const orders = [
      order("delivered", [
        { product_id: "p1", product_name: "Refrigerante", quantity: 1, subtotal: 6 },
        { product_id: "p2", product_name: "Pizza", quantity: 5, subtotal: 150 },
      ]),
    ];
    const result = aggregateBestSellers(orders);
    expect(result.map((r) => r.productKey)).toEqual(["p2", "p1"]);
  });

  it("respeita o limite informado", () => {
    const orders = [
      order("delivered", [
        { product_id: "p1", product_name: "A", quantity: 3, subtotal: 10 },
        { product_id: "p2", product_name: "B", quantity: 2, subtotal: 10 },
        { product_id: "p3", product_name: "C", quantity: 1, subtotal: 10 },
      ]),
    ];
    expect(aggregateBestSellers(orders, 2)).toHaveLength(2);
  });

  it("sem pedidos válidos: ranking vazio (nunca dado fictício)", () => {
    expect(aggregateBestSellers([])).toEqual([]);
    expect(aggregateBestSellers([order("cancelled", [{ product_id: "p1", product_name: "X", quantity: 1, subtotal: 10 }])])).toEqual([]);
  });
});

describe("getBestSellingProducts — isolamento por restaurante", () => {
  it("sempre filtra a query por restaurant_id, nunca confia em outro escopo", async () => {
    const { client, calls } = createFakeSupabase([]);
    await getBestSellingProducts(client, "restaurante-abc");
    expect(calls).toContainEqual({ method: "eq", args: ["restaurant_id", "restaurante-abc"] });
    expect(calls).toContainEqual({ method: "from", args: ["orders"] });
  });

  it("normaliza quantity/subtotal (numeric/int do Postgres) para number antes de agregar", async () => {
    const { client } = createFakeSupabase([
      { status: "delivered", order_items: [{ product_id: "p1", product_name: "X-Burger", quantity: "2", subtotal: "40.00" }] },
    ]);
    const result = await getBestSellingProducts(client, "r1");
    expect(result).toEqual([{ productKey: "p1", productName: "X-Burger", quantitySold: 2, revenue: 40 }]);
  });
});
