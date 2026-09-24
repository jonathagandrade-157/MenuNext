import { describe, expect, it } from "vitest";
import {
  computeChannelSplit,
  computeCustomersToday,
  computeDashboardInsights,
  computeDeliveryToday,
  computeEstimatedMargin,
  computeHourlyMovement,
  computeLiveQueue,
  computePaymentSplit,
  computeYesterdayComparison,
  type DashboardTodayOrderRow,
} from "./dashboard";
import type { CustomerOrderRow } from "./customers";

function makeOrder(overrides: Partial<DashboardTodayOrderRow> = {}): DashboardTodayOrderRow {
  return {
    status: "delivered",
    total: 50,
    fulfillment_type: "delivery",
    payment_method: "pix",
    customer_phone: "11912345678",
    created_at: "2026-01-15T12:00:00-03:00",
    preparing_at: null,
    ready_at: null,
    delivered_at: null,
    order_items: [],
    ...overrides,
  };
}

describe("computeHourlyMovement", () => {
  it("agrupa pedidos válidos por hora local, só até a hora atual", () => {
    const now = new Date("2026-01-15T15:30:00-03:00");
    const orders = [
      makeOrder({ created_at: "2026-01-15T12:05:00-03:00", total: 30 }),
      makeOrder({ created_at: "2026-01-15T12:40:00-03:00", total: 20 }),
      makeOrder({ created_at: "2026-01-15T14:00:00-03:00", total: 100 }),
    ];
    const result = computeHourlyMovement(orders, now);
    expect(result).toHaveLength(16); // horas 0..15
    expect(result[12]).toEqual({ hour: 12, orders: 2, revenue: 50 });
    expect(result[14]).toEqual({ hour: 14, orders: 1, revenue: 100 });
    expect(result[15]).toEqual({ hour: 15, orders: 0, revenue: 0 });
  });

  it("nunca conta pedido cancelado no movimento", () => {
    const now = new Date("2026-01-15T13:00:00-03:00");
    const orders = [makeOrder({ created_at: "2026-01-15T12:00:00-03:00", status: "cancelled", total: 999 })];
    const result = computeHourlyMovement(orders, now);
    expect(result[12]).toEqual({ hour: 12, orders: 0, revenue: 0 });
  });
});

describe("computeLiveQueue", () => {
  it("agrupa status ativos nas 3 colunas operacionais relevantes para uma fila 'agora'", () => {
    const result = computeLiveQueue(["received", "confirmed", "preparing", "ready", "ready", "out_for_delivery"]);
    expect(result).toEqual({ novos: 2, preparando: 1, prontos: 2 });
  });

  it("fila vazia quando não há pedidos ativos", () => {
    expect(computeLiveQueue([])).toEqual({ novos: 0, preparando: 0, prontos: 0 });
  });
});

describe("computeEstimatedMargin", () => {
  it("calcula receita, custo e margem % quando todo item tem custo cadastrado", () => {
    const items = [{ product_id: "p1", product_name: "X", quantity: 2, subtotal: 100 }];
    const costById = new Map([["p1", 20]]);
    expect(computeEstimatedMargin(items, costById)).toEqual({ revenue: 100, cost: 40, marginPercent: 60 });
  });

  it("retorna null quando nenhum item vendido hoje tem custo cadastrado", () => {
    const items = [{ product_id: "p1", product_name: "X", quantity: 1, subtotal: 50 }];
    expect(computeEstimatedMargin(items, new Map())).toBeNull();
  });

  it("soma receita/custo só dos itens com custo, mas ainda retorna resultado (custo parcial)", () => {
    const items = [
      { product_id: "p1", product_name: "X", quantity: 1, subtotal: 50 },
      { product_id: "p2", product_name: "Y", quantity: 1, subtotal: 30 },
    ];
    const costById = new Map([["p1", 10]]);
    const result = computeEstimatedMargin(items, costById);
    expect(result).toEqual({ revenue: 80, cost: 10, marginPercent: (70 / 80) * 100 });
  });
});

describe("computeChannelSplit", () => {
  it("separa contagem e receita por delivery/retirada, ignorando cancelados", () => {
    const orders = [
      makeOrder({ fulfillment_type: "delivery", total: 40 }),
      makeOrder({ fulfillment_type: "pickup", total: 20 }),
      makeOrder({ fulfillment_type: "delivery", total: 999, status: "cancelled" }),
    ];
    expect(computeChannelSplit(orders)).toEqual({
      delivery: { count: 1, revenue: 40 },
      pickup: { count: 1, revenue: 20 },
    });
  });
});

describe("computePaymentSplit", () => {
  it("separa contagem e receita por método de pagamento", () => {
    const orders = [
      makeOrder({ payment_method: "pix", total: 50 }),
      makeOrder({ payment_method: "cash", total: 30 }),
      makeOrder({ payment_method: "pix", total: 20 }),
    ];
    const result = computePaymentSplit(orders);
    expect(result.pix).toEqual({ count: 2, revenue: 70 });
    expect(result.cash).toEqual({ count: 1, revenue: 30 });
    expect(result.card).toEqual({ count: 0, revenue: 0 });
  });
});

describe("computeDeliveryToday", () => {
  it("conta só pedidos de delivery e calcula tempo médio só dos entregues com timestamp", () => {
    const orders = [
      makeOrder({
        fulfillment_type: "delivery",
        status: "delivered",
        total: 40,
        created_at: "2026-01-15T12:00:00-03:00",
        delivered_at: "2026-01-15T12:30:00-03:00",
      }),
      makeOrder({ fulfillment_type: "delivery", status: "out_for_delivery", total: 30 }),
      makeOrder({ fulfillment_type: "pickup", total: 999 }),
    ];
    const result = computeDeliveryToday(orders);
    expect(result.count).toBe(2);
    expect(result.revenue).toBe(70);
    expect(result.averageMinutes).toBe(30);
  });

  it("tempo médio null quando nenhum pedido de delivery foi entregue ainda hoje", () => {
    const orders = [makeOrder({ fulfillment_type: "delivery", status: "preparing" })];
    expect(computeDeliveryToday(orders).averageMinutes).toBeNull();
  });
});

describe("computeCustomersToday", () => {
  function makeCustomerOrder(overrides: Partial<CustomerOrderRow> = {}): CustomerOrderRow {
    return {
      id: "o1",
      order_number: 1,
      customer_name: "Cliente",
      customer_phone: "11900000001",
      status: "delivered",
      fulfillment_type: "delivery",
      payment_method: "pix",
      total: 50,
      created_at: "2026-01-10T12:00:00-03:00",
      delivery_street: null,
      delivery_number: null,
      delivery_complement: null,
      delivery_neighborhood: null,
      delivery_city: null,
      delivery_state: null,
      ...overrides,
    };
  }

  it("classifica cliente sem pedido antes de hoje como novo", () => {
    const today = [makeOrder({ customer_phone: "11900000001" })];
    const allHistory = [makeCustomerOrder({ id: "today1", customer_phone: "11900000001", created_at: "2026-01-15T12:00:00-03:00" })];
    const result = computeCustomersToday(today, allHistory);
    expect(result).toEqual({ attended: 1, new: 1, returning: 0 });
  });

  it("classifica cliente com pedido válido antes de hoje como recorrente", () => {
    const today = [makeOrder({ customer_phone: "11900000001" })];
    const allHistory = [
      makeCustomerOrder({ id: "old1", customer_phone: "11900000001", created_at: "2026-01-01T12:00:00-03:00" }),
      makeCustomerOrder({ id: "today1", customer_phone: "11900000001", created_at: "2026-01-15T12:00:00-03:00" }),
    ];
    const result = computeCustomersToday(today, allHistory);
    expect(result).toEqual({ attended: 1, new: 0, returning: 1 });
  });

  it("nenhum pedido hoje retorna zeros sem processar histórico", () => {
    expect(computeCustomersToday([], [])).toEqual({ attended: 0, new: 0, returning: 0 });
  });
});

describe("computeYesterdayComparison", () => {
  it("calcula % de variação", () => {
    expect(computeYesterdayComparison(120, 100)).toBe(20);
    expect(computeYesterdayComparison(80, 100)).toBe(-20);
  });

  it("retorna null quando ontem foi zero (evita divisão por zero)", () => {
    expect(computeYesterdayComparison(50, 0)).toBeNull();
  });
});

describe("computeDashboardInsights", () => {
  it("deriva produto destaque, horário de pico e canal forte a partir dos dados de hoje", () => {
    const bestSellers = [{ productKey: "p1", productName: "Burger", quantitySold: 5, revenue: 100 }];
    const hourly = [
      { hour: 11, orders: 1, revenue: 20 },
      { hour: 12, orders: 4, revenue: 80 },
    ];
    const channels = { delivery: { count: 3, revenue: 80 }, pickup: { count: 1, revenue: 20 } };
    const insights = computeDashboardInsights(bestSellers, hourly, channels);
    expect(insights).toContainEqual({ label: "Produto destaque", value: "Burger (5 vendidos hoje)" });
    expect(insights).toContainEqual({ label: "Horário de maior movimento hoje", value: "12h" });
    expect(insights).toContainEqual({ label: "Canal forte hoje", value: "Delivery (75%)" });
  });

  it("dia sem nenhum pedido não gera insights falsos", () => {
    const channels = { delivery: { count: 0, revenue: 0 }, pickup: { count: 0, revenue: 0 } };
    expect(computeDashboardInsights([], [], channels)).toEqual([]);
  });
});
