import { describe, expect, it } from "vitest";
import { aggregateCustomers, type CustomerOrderRow } from "./customers";

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
