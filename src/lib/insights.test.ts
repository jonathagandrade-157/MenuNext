import { describe, expect, it } from "vitest";
import {
  computeComboSuggestions,
  computeMarginInsight,
  computePeakInsight,
  suggestPriceForMargin,
  type InsightOrderRow,
} from "./insights";
import type { ComboWithItems, Product } from "./tenant";

const product = (id: string, price: number, cost: number | null, extra: Partial<Product> = {}): Product => ({
  id,
  restaurant_id: "r1",
  category_id: "c1",
  name: `Produto ${id}`,
  description: null,
  price,
  cost,
  is_available: true,
  display_order: 0,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  ...extra,
});

const order = (created_at: string, ids: string[], status: InsightOrderRow["status"] = "delivered"): InsightOrderRow => ({
  status,
  created_at,
  order_items: ids.map((id) => ({ product_id: id, product_name: `Produto ${id}`, quantity: 1, subtotal: 10 })),
});

// 22:00Z = 19:00 em São Paulo (UTC-3); 2026-10-20 é terça-feira.
const at = (hourSp: number, day = 20) => `2026-10-${String(day).padStart(2, "0")}T${String((hourSp + 3) % 24).padStart(2, "0")}:00:00Z`;

describe("computePeakInsight", () => {
  it("não opina com poucos pedidos", () => {
    expect(computePeakInsight([order(at(19), ["a"])])).toBeNull();
  });

  it("acha o pico no horário de São Paulo, o horário fraco dentro da faixa e o dia mais forte", () => {
    const rows: InsightOrderRow[] = [
      ...Array.from({ length: 6 }, () => order(at(19), ["a"])),
      ...Array.from({ length: 3 }, () => order(at(12), ["a"])),
      order(at(15), ["a"]),
      order(at(15, 21), ["a"], "cancelled"), // cancelado nunca conta
    ];
    const peak = computePeakInsight(rows)!;
    expect(peak.totalOrders).toBe(10);
    expect(peak.peakHour).toMatchObject({ hour: 19, orders: 6 });
    expect(peak.peakHour.sharePercent).toBeCloseTo(60);
    expect(peak.slowHour).toEqual({ hour: 13, orders: 0 });
    expect(peak.peakWeekday).toEqual({ weekday: "terça", orders: 10 });
  });

  it("meia-noite em São Paulo cai na hora 0, não na 24", () => {
    const rows = Array.from({ length: 10 }, () => order("2026-10-20T03:00:00Z", ["a"]));
    expect(computePeakInsight(rows)!.peakHour.hour).toBe(0);
  });

  it("sem horário fraco quando todas as horas da faixa têm o mesmo movimento", () => {
    const rows = Array.from({ length: 10 }, () => order(at(19), ["a"]));
    expect(computePeakInsight(rows)!.slowHour).toBeNull();
  });
});

describe("computeMarginInsight", () => {
  it("lista só quem vendeu com margem abaixo de 30%, do mais vendido ao menos, com preço sugerido", () => {
    const products = [
      product("a", 20, 16), // 20% de margem
      product("b", 20, 15), // 25% de margem
      product("c", 20, 8), // 60% - saudável
      product("d", 20, 18), // 10%, mas não vendeu
      product("e", 20, null), // vendeu sem custo
    ];
    const orders = [
      order(at(19), ["a", "c", "e"]),
      order(at(19), ["b"]),
      order(at(19), ["b"]),
      order(at(19), ["a"], "cancelled"),
    ];
    const result = computeMarginInsight(orders, products);
    expect(result.lowMargin.map((p) => p.productId)).toEqual(["b", "a"]);
    expect(result.lowMargin[0]).toMatchObject({ quantitySold: 2, marginPercent: 25, suggestedPrice: 23.1 });
    expect(result.soldWithoutCost).toBe(1);
  });

  it("preço sugerido alcança a margem alvo e arredonda para cima em R$ 0,10", () => {
    expect(suggestPriceForMargin(13)).toBe(20);
    expect(suggestPriceForMargin(10)).toBe(15.4);
    const price = suggestPriceForMargin(7.77);
    expect((price - 7.77) / price).toBeGreaterThanOrEqual(0.35);
  });
});

describe("computeComboSuggestions", () => {
  const products = [product("a", 30, 10), product("b", 10, 3), product("c", 8, 2), product("x", 5, 1, { is_available: false })];

  it("sugere pares comprados juntos com frequência, ordenados, com preço com desconto", () => {
    const orders = [
      ...Array.from({ length: 4 }, () => order(at(19), ["a", "b"])),
      ...Array.from({ length: 3 }, () => order(at(19), ["a", "c"])),
      order(at(19), ["b", "c"]), // 1 vez: coincidência
      order(at(19), ["a"]),
    ];
    const result = computeComboSuggestions(orders, products, []);
    expect(result.map((s) => [s.productAId, s.productBId, s.pairOrders])).toEqual([
      ["a", "b", 4],
      ["a", "c", 3],
    ]);
    expect(result[0].regularPrice).toBe(40);
    expect(result[0].suggestedPrice).toBe(36);
    // b aparece em 5 pedidos, 4 deles com a.
    expect(result[0].togetherPercent).toBeCloseTo(80);
  });

  it("ignora pares que já formam um combo, produto indisponível e pedido cancelado", () => {
    const orders = [
      ...Array.from({ length: 3 }, () => order(at(19), ["a", "b"])),
      ...Array.from({ length: 3 }, () => order(at(19), ["a", "x"])),
      ...Array.from({ length: 5 }, () => order(at(19), ["b", "c"], "cancelled")),
    ];
    const combo = { combo_items: [{ product_id: "a" }, { product_id: "b" }] } as unknown as ComboWithItems;
    expect(computeComboSuggestions(orders, products, [combo])).toEqual([]);
  });

  it("o mesmo produto repetido no pedido não forma par consigo mesmo", () => {
    const orders = Array.from({ length: 5 }, () => order(at(19), ["a", "a"]));
    expect(computeComboSuggestions(orders, products, [])).toEqual([]);
  });
});
