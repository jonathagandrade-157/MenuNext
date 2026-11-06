import { describe, expect, it } from "vitest";
import { computeSalesReport, csvCell, getReportOrders, ordersToCsv, parseReportPeriod, type ReportOrder } from "./reports";

const NOW = new Date("2026-11-05T15:00:00Z"); // 12:00 em São Paulo

function order(over: Partial<ReportOrder> = {}): ReportOrder {
  return {
    order_number: 1, created_at: "2026-11-04T15:00:00Z", status: "delivered", fulfillment_type: "delivery", payment_method: "pix",
    subtotal: 40, discount_amount: 5, delivery_fee: 6, total: 41, order_items: [{ product_name: "X-Burger", quantity: 2, subtotal: 40 }], ...over,
  };
}

describe("parseReportPeriod", () => {
  it("padrão: últimos 30 dias até hoje (SP)", () => {
    const r = parseReportPeriod(undefined, undefined, NOW);
    expect(r.ok && r.period.from).toBe("2026-10-07");
    expect(r.ok && r.period.to).toBe("2026-11-05");
    expect(r.ok && r.period.days).toBe(30);
  });
  it("limites em UTC: dia SP começa às 03:00Z e termina no dia seguinte", () => {
    const r = parseReportPeriod("2026-11-01", "2026-11-01", NOW);
    expect(r.ok && r.period.startIso).toBe("2026-11-01T03:00:00.000Z");
    expect(r.ok && r.period.endIso).toBe("2026-11-02T03:00:00.000Z");
  });
  it("recusa datas inválidas, invertidas, futuras e períodos longos", () => {
    for (const [f, t] of [["2026-02-30", "2026-03-01"], ["abc", "2026-03-01"], ["2026-11-05", "2026-11-01"], ["2026-11-01", "2026-12-01"], ["2024-01-01", "2026-11-01"], ["2026-1-1", "2026-11-01"]]) {
      expect(parseReportPeriod(f, t, NOW).ok, `${f}..${t}`).toBe(false);
    }
  });
  it("aceita exatamente 366 dias", () => {
    expect(parseReportPeriod("2025-11-05", "2026-11-05", NOW).ok).toBe(true);
  });
});

describe("computeSalesReport", () => {
  const rows = [
    order({ order_number: 1 }),
    order({ order_number: 2, payment_method: "cash", fulfillment_type: "counter", total: 20, subtotal: 20, discount_amount: 0, delivery_fee: 0, order_items: [{ product_name: "Suco", quantity: 1, subtotal: 20 }] }),
    order({ order_number: 3, status: "cancelled", total: 99 }),
    order({ order_number: 4, created_at: "2026-11-05T02:00:00Z", payment_method: "card", order_items: [{ product_name: "X-Burger", quantity: 1, subtotal: 20 }] }),
  ];
  const r = computeSalesReport(rows);
  it("cancelados não entram no faturamento nem nos itens", () => {
    expect(r.orders).toBe(3);
    expect(r.cancelled).toBe(1);
    expect(r.cancelRate).toBeCloseTo(0.25);
    expect(r.revenue).toBe(102);
    expect(r.averageTicket).toBe(34);
    expect(r.discounts).toBe(10);
    expect(r.deliveryFees).toBe(12);
  });
  it("agrupa por pagamento e tipo", () => {
    expect(r.byPayment.pix).toEqual({ orders: 1, revenue: 41 });
    expect(r.byPayment.cash).toEqual({ orders: 1, revenue: 20 });
    expect(r.byFulfillment.counter.orders).toBe(1);
  });
  it("série diária no fuso de SP (02:00Z do dia 5 ainda é dia 4 à noite)", () => {
    expect(r.daily).toEqual([{ date: "2026-11-04", orders: 3, revenue: 102 }]);
  });
  it("produtos mais vendidos por quantidade", () => {
    expect(r.topProducts[0]).toEqual({ name: "X-Burger", quantity: 3, revenue: 60 });
    expect(r.topProducts.map((p) => p.name)).not.toContain("Cancelado");
  });
  it("sem pedidos: zeros, sem divisão por zero", () => {
    const e = computeSalesReport([]);
    expect(e).toMatchObject({ orders: 0, revenue: 0, averageTicket: 0, cancelRate: 0, daily: [], topProducts: [] });
  });
});

describe("CSV", () => {
  it("neutraliza injeção de fórmula e escapa aspas/separador", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    for (const v of ["+1", "-1", "@a", "\tX"]) expect(csvCell(v).replace(/^"/, "").startsWith("'")).toBe(true);
    expect(csvCell("a;b")).toBe("\"a;b\"");
    expect(csvCell("normal")).toBe("normal");
    expect(csvCell(12.5)).toBe("12,5");
  });
  it("gera BOM, cabeçalho, vírgula decimal e fuso de SP — sem dados pessoais", () => {
    const csv = ordersToCsv([order({ order_items: [{ product_name: "=cmd|' /C calc'!A0", quantity: 1, subtotal: 1 }] })]);
    expect(csv.startsWith("﻿Pedido;Data;Hora")).toBe(true);
    const line = csv.split("\r\n")[1];
    expect(line).toContain("2026-11-04;12:00;Entregue;Entrega;Pix;40,00;5,00;6,00;41,00;");
    expect(line.endsWith(";1x =cmd|' /C calc'!A0")).toBe(true); // a célula começa com "1x": não é fórmula
    const suco = ordersToCsv([order({ order_items: [{ product_name: "Suco 1.50", quantity: 1, subtotal: 1 }] })]);
    expect(suco).toContain("1x Suco 1.50"); // nomes de produto não são reformatados
    expect(csv.toLowerCase()).not.toMatch(/telefone|cliente/);
  });
});

describe("getReportOrders", () => {
  const period = (parseReportPeriod("2026-11-01", "2026-11-05", NOW) as { ok: true; period: never }).period;
  function client(pages: number[], calls: unknown[][] = []) {
    let i = 0;
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lt", "order"]) chain[m] = (...a: unknown[]) => (calls.push([m, ...a]), chain);
    chain.range = async () => ({ data: Array.from({ length: pages[i++] ?? 0 }, (_, n) => order({ order_number: n })), error: null });
    return { from: () => chain } as never;
  }
  it("pagina até a última página curta", async () => {
    const calls: unknown[][] = [];
    const r = await getReportOrders(client([1000, 250], calls), "rest-1", period);
    expect(r.rows).toHaveLength(1250);
    expect(r.truncated).toBe(false);
    expect(calls).toContainEqual(["eq", "restaurant_id", "rest-1"]);
  });
  it("marca truncado ao bater o teto", async () => {
    const r = await getReportOrders(client(Array(10).fill(1000)), "rest-1", period);
    expect(r.rows).toHaveLength(10_000);
    expect(r.truncated).toBe(true);
  });
});
