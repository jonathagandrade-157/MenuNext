import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getProductCosts, getProducts } from "./tenant";

/** Cliente de mentira que responde por tabela: from(tabela).select(...).eq(...)[.order(...)]. */
function fakeClient(tables: Record<string, { data: unknown; error: unknown }>) {
  return {
    from: vi.fn((table: string) => {
      const result = tables[table] ?? { data: [], error: null };
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.order = () => Promise.resolve(result);
      chain.then = (resolve: (v: unknown) => unknown) => resolve(result);
      return chain;
    }),
  } as unknown as SupabaseClient;
}

describe("getProductCosts", () => {
  it("monta o mapa produto → custo como número", async () => {
    const client = fakeClient({
      product_costs: { data: [{ product_id: "p1", cost: "12.50" }, { product_id: "p2", cost: "0.00" }], error: null },
    });
    const costs = await getProductCosts(client, "r1");
    expect(costs.get("p1")).toBe(12.5);
    expect(costs.get("p2")).toBe(0);
    expect(costs.size).toBe(2);
  });

  it("quem não é da loja (ou qualquer erro) recebe mapa vazio, sem derrubar a tela", async () => {
    const client = fakeClient({ product_costs: { data: null, error: { message: "permission denied" } } });
    expect((await getProductCosts(client, "r1")).size).toBe(0);
  });
});

describe("getProducts", () => {
  it("junta o custo da tabela product_costs e ignora a coluna antiga products.cost", async () => {
    const client = fakeClient({
      products: {
        data: [
          { id: "p1", price: "10.00", cost: "999.99", name: "A" },
          { id: "p2", price: "5.00", cost: null, name: "B" },
        ],
        error: null,
      },
      product_costs: { data: [{ product_id: "p1", cost: "3.00" }], error: null },
    });
    const products = await getProducts(client, "r1");
    expect(products.find((p) => p.id === "p1")?.cost).toBe(3);
    expect(products.find((p) => p.id === "p2")?.cost).toBeNull();
    expect(products.find((p) => p.id === "p1")?.price).toBe(10);
  });
});
