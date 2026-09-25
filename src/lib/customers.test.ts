import { describe, expect, it } from "vitest";
import { aggregateCustomers, computeCustomerStats, getCustomerSegments, type CustomerOrderRow, type CustomerSummary } from "./customers";

function makeOrder(overrides: Partial<CustomerOrderRow> = {}): CustomerOrderRow {
  return {
    id: "o1",
    order_number: 1,
    customer_name: "Maria",
    customer_phone: "(11) 91234-5678",
    status: "delivered",
    fulfillment_type: "delivery",
    payment_method: "pix",
    total: 50,
    created_at: "2026-01-01T12:00:00Z",
    delivery_street: "Rua A",
    delivery_number: "10",
    delivery_complement: null,
    delivery_neighborhood: "Centro",
    delivery_city: "São Paulo",
    delivery_state: "SP",
    ...overrides,
  };
}

describe("aggregateCustomers", () => {
  it("agrupa pedidos do mesmo telefone (independente de formatação) num único cliente", () => {
    const orders = [
      makeOrder({ id: "o1", customer_phone: "(11) 91234-5678", total: 50 }),
      makeOrder({ id: "o2", customer_phone: "11912345678", total: 30, created_at: "2026-01-02T12:00:00Z" }),
    ];
    const result = aggregateCustomers(orders);
    expect(result).toHaveLength(1);
    expect(result[0].numberOfOrders).toBe(2);
    expect(result[0].totalSpent).toBe(80);
    expect(result[0].averageTicket).toBe(40);
  });

  it("nunca conta pedido cancelado em número de pedidos/total gasto/ticket médio", () => {
    const orders = [
      makeOrder({ id: "o1", total: 50, status: "delivered" }),
      makeOrder({ id: "o2", total: 1000, status: "cancelled", created_at: "2026-01-02T12:00:00Z" }),
    ];
    const result = aggregateCustomers(orders);
    expect(result[0].numberOfOrders).toBe(1);
    expect(result[0].totalSpent).toBe(50);
    expect(result[0].orders).toHaveLength(2);
  });

  it("usa nome/endereço do pedido mais recente do cliente", () => {
    const orders = [
      makeOrder({ id: "o1", customer_name: "Maria Antiga", delivery_street: "Rua Velha", created_at: "2026-01-01T12:00:00Z" }),
      makeOrder({ id: "o2", customer_name: "Maria Nova", delivery_street: "Rua Nova", created_at: "2026-01-03T12:00:00Z" }),
    ];
    const result = aggregateCustomers(orders);
    expect(result[0].name).toBe("Maria Nova");
    expect(result[0].addresses[0]).toContain("Rua Nova");
  });

  it("ordena clientes pelo pedido mais recente", () => {
    const orders = [
      makeOrder({ id: "o1", customer_phone: "11900000001", created_at: "2026-01-01T12:00:00Z" }),
      makeOrder({ id: "o2", customer_phone: "11900000002", created_at: "2026-01-05T12:00:00Z" }),
    ];
    const result = aggregateCustomers(orders);
    expect(result[0].phone).toBe("11900000002");
    expect(result[1].phone).toBe("11900000001");
  });

  it("cliente sem endereço de entrega (retirada) não gera endereço vazio na lista", () => {
    const orders = [makeOrder({ delivery_street: null, delivery_number: null })];
    const result = aggregateCustomers(orders);
    expect(result[0].addresses).toHaveLength(0);
  });
});

function makeCustomer(overrides: Partial<CustomerSummary> = {}): CustomerSummary {
  const orders = overrides.orders ?? [
    { id: "o1", orderNumber: 1, status: "delivered" as const, total: 50, createdAt: "2026-03-10T12:00:00-03:00" },
  ];
  return {
    phone: "11900000001",
    name: "Maria",
    numberOfOrders: orders.length,
    totalSpent: 50,
    averageTicket: 50,
    lastOrderAt: orders[0].createdAt,
    addresses: [],
    orders,
    ...overrides,
  };
}

describe("getCustomerSegments", () => {
  const now = new Date("2026-03-15T12:00:00-03:00");

  it("marca como recorrente quem tem 2+ pedidos válidos", () => {
    const customer = makeCustomer({
      numberOfOrders: 2,
      orders: [
        { id: "o1", orderNumber: 2, status: "delivered", total: 30, createdAt: "2026-03-12T12:00:00-03:00" },
        { id: "o2", orderNumber: 1, status: "delivered", total: 30, createdAt: "2026-01-01T12:00:00-03:00" },
      ],
    });
    expect(getCustomerSegments(customer, now)).toContain("recorrente");
  });

  it("marca como novo quem fez o 1º pedido no mês corrente (fuso de São Paulo)", () => {
    const customer = makeCustomer({
      numberOfOrders: 1,
      orders: [{ id: "o1", orderNumber: 1, status: "delivered", total: 50, createdAt: "2026-03-01T02:30:00Z" }],
    });
    // 2026-03-01T02:30:00Z = 2026-02-28T23:30:00-03:00 em SP — mês anterior.
    expect(getCustomerSegments(customer, now)).not.toContain("novo");

    const customerSameMonth = makeCustomer({
      numberOfOrders: 1,
      orders: [{ id: "o1", orderNumber: 1, status: "delivered", total: 50, createdAt: "2026-03-01T13:00:00-03:00" }],
    });
    expect(getCustomerSegments(customerSameMonth, now)).toContain("novo");
  });

  it("nunca marca como novo quem já é recorrente (2+ pedidos, mesmo se o 1º foi neste mês)", () => {
    const customer = makeCustomer({
      numberOfOrders: 2,
      orders: [
        { id: "o1", orderNumber: 2, status: "delivered", total: 30, createdAt: "2026-03-14T12:00:00-03:00" },
        { id: "o2", orderNumber: 1, status: "delivered", total: 30, createdAt: "2026-03-02T12:00:00-03:00" },
      ],
    });
    expect(getCustomerSegments(customer, now)).not.toContain("novo");
  });

  it("marca como inativo quem não pede há 60 dias ou mais", () => {
    const inactive = makeCustomer({ lastOrderAt: "2026-01-10T12:00:00-03:00" });
    expect(getCustomerSegments(inactive, now)).toContain("inativo");

    const active = makeCustomer({ lastOrderAt: "2026-03-01T12:00:00-03:00" });
    expect(getCustomerSegments(active, now)).not.toContain("inativo");
  });

  it("cliente com 1 pedido fora do mês corrente e sem 60 dias não cai em nenhum segmento", () => {
    const customer = makeCustomer({
      lastOrderAt: "2026-02-20T12:00:00-03:00",
      orders: [{ id: "o1", orderNumber: 1, status: "delivered", total: 50, createdAt: "2026-02-20T12:00:00-03:00" }],
    });
    expect(getCustomerSegments(customer, now)).toEqual([]);
  });
});

describe("computeCustomerStats", () => {
  const now = new Date("2026-03-15T12:00:00-03:00");

  it("calcula ticket médio real (receita total / pedidos totais), não a média das médias", () => {
    const customers = [
      makeCustomer({
        phone: "1",
        numberOfOrders: 2,
        totalSpent: 100,
        orders: [
          { id: "a", orderNumber: 2, status: "delivered", total: 90, createdAt: "2026-03-10T12:00:00-03:00" },
          { id: "b", orderNumber: 1, status: "delivered", total: 10, createdAt: "2026-01-01T12:00:00-03:00" },
        ],
      }),
      makeCustomer({ phone: "2", numberOfOrders: 1, totalSpent: 50, orders: [{ id: "c", orderNumber: 1, status: "delivered", total: 50, createdAt: "2026-03-01T12:00:00-03:00" }] }),
    ];
    const stats = computeCustomerStats(customers, now);
    expect(stats.totalOrders).toBe(3);
    expect(stats.averageTicket).toBeCloseTo(150 / 3);
  });

  it("conta recorrentes e novos deste mês corretamente", () => {
    const customers = [
      makeCustomer({
        phone: "1",
        numberOfOrders: 2,
        orders: [
          { id: "a", orderNumber: 2, status: "delivered", total: 30, createdAt: "2026-03-10T12:00:00-03:00" },
          { id: "b", orderNumber: 1, status: "delivered", total: 30, createdAt: "2026-01-01T12:00:00-03:00" },
        ],
      }),
      makeCustomer({ phone: "2", numberOfOrders: 1, orders: [{ id: "c", orderNumber: 1, status: "delivered", total: 50, createdAt: "2026-03-05T12:00:00-03:00" }] }),
    ];
    const stats = computeCustomerStats(customers, now);
    expect(stats.recurring).toBe(1);
    expect(stats.newThisMonth).toBe(1);
    expect(stats.recurringPercent).toBeCloseTo(50);
  });

  it("base vazia não gera divisão por zero", () => {
    const stats = computeCustomerStats([], now);
    expect(stats).toEqual({
      totalCustomers: 0,
      newThisMonth: 0,
      recurring: 0,
      recurringPercent: 0,
      averageTicket: 0,
      totalOrders: 0,
    });
  });
});
