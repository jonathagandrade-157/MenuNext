import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeDashboardMetrics,
  getKanbanColumnForStatus,
  getNextOrderStatus,
  getRecentOrders,
  isTerminalOrderStatus,
  orderTrackingChannelName,
  type DashboardOrderRow,
  type OrderStatus,
} from "./orders";

/** Fake mínimo do query builder do supabase-js — registra cada chamada
 * (.from/.select/.eq/...) para provar que o fetcher sempre filtra por
 * restaurant_id, sem precisar de um banco real. `then` torna o objeto
 * "awaitable" em qualquer ponto da cadeia, já que fetchers diferentes
 * terminam a cadeia em métodos diferentes (.limit, .eq, ...). */
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
    order: (...args: unknown[]) => {
      calls.push({ method: "order", args });
      return query;
    },
    limit: (...args: unknown[]) => {
      calls.push({ method: "limit", args });
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

function dashboardRow(overrides: Partial<DashboardOrderRow> & { status: OrderStatus; total: number }): DashboardOrderRow {
  return {
    created_at: "2026-09-09T12:00:00.000Z",
    preparing_at: null,
    ready_at: null,
    delivered_at: null,
    ...overrides,
  };
}

describe("getNextOrderStatus — entrega", () => {
  it("received -> confirmed", () => {
    expect(getNextOrderStatus("received", "delivery")).toBe("confirmed");
  });
  it("confirmed -> preparing", () => {
    expect(getNextOrderStatus("confirmed", "delivery")).toBe("preparing");
  });
  it("preparing -> ready", () => {
    expect(getNextOrderStatus("preparing", "delivery")).toBe("ready");
  });
  it("ready -> out_for_delivery (somente delivery)", () => {
    expect(getNextOrderStatus("ready", "delivery")).toBe("out_for_delivery");
  });
  it("out_for_delivery -> delivered", () => {
    expect(getNextOrderStatus("out_for_delivery", "delivery")).toBe("delivered");
  });
  it("delivered é terminal (sem próximo)", () => {
    expect(getNextOrderStatus("delivered", "delivery")).toBeNull();
  });
});

describe("getNextOrderStatus — retirada", () => {
  it("received -> confirmed", () => {
    expect(getNextOrderStatus("received", "pickup")).toBe("confirmed");
  });
  it("preparing -> ready", () => {
    expect(getNextOrderStatus("preparing", "pickup")).toBe("ready");
  });
  it("ready -> picked_up (somente retirada)", () => {
    expect(getNextOrderStatus("ready", "pickup")).toBe("picked_up");
  });
  it("picked_up é terminal (sem próximo)", () => {
    expect(getNextOrderStatus("picked_up", "pickup")).toBeNull();
  });
});

describe("getNextOrderStatus — transições bloqueadas (não existem no fluxo)", () => {
  it("retirada nunca usa out_for_delivery: ready(pickup) não é 'out_for_delivery'", () => {
    expect(getNextOrderStatus("ready", "pickup")).not.toBe("out_for_delivery");
  });
  it("entrega nunca usa picked_up: ready(delivery) não é 'picked_up'", () => {
    expect(getNextOrderStatus("ready", "delivery")).not.toBe("picked_up");
  });
  it("cancelled não tem próximo passo (fora do fluxo linear)", () => {
    expect(getNextOrderStatus("cancelled", "delivery")).toBeNull();
    expect(getNextOrderStatus("cancelled", "pickup")).toBeNull();
  });
});

describe("isTerminalOrderStatus", () => {
  it("pedido já entregue é terminal", () => {
    expect(isTerminalOrderStatus("delivered", "delivery")).toBe(true);
  });
  it("pedido já retirado é terminal", () => {
    expect(isTerminalOrderStatus("picked_up", "pickup")).toBe(true);
  });
  it("cancelado é terminal", () => {
    expect(isTerminalOrderStatus("cancelled", "delivery")).toBe(true);
  });
  it("pedido em preparo não é terminal", () => {
    expect(isTerminalOrderStatus("preparing", "delivery")).toBe(false);
  });
});

describe("getKanbanColumnForStatus", () => {
  it("received e confirmed caem em 'novos'", () => {
    expect(getKanbanColumnForStatus("received")).toBe("novos");
    expect(getKanbanColumnForStatus("confirmed")).toBe("novos");
  });
  it("preparing cai em 'preparando'", () => {
    expect(getKanbanColumnForStatus("preparing")).toBe("preparando");
  });
  it("ready cai em 'prontos'", () => {
    expect(getKanbanColumnForStatus("ready")).toBe("prontos");
  });
  it("out_for_delivery cai em 'saiu_para_entrega'", () => {
    expect(getKanbanColumnForStatus("out_for_delivery")).toBe("saiu_para_entrega");
  });
  it("delivered e picked_up caem em 'entregues'", () => {
    expect(getKanbanColumnForStatus("delivered")).toBe("entregues");
    expect(getKanbanColumnForStatus("picked_up")).toBe("entregues");
  });
});

describe("orderTrackingChannelName", () => {
  it("gera um nome de canal determinístico a partir do public_id", () => {
    expect(orderTrackingChannelName("abc-123")).toBe("order-tracking:abc-123");
  });
  it("dois public_id diferentes geram canais diferentes (isolamento por pedido)", () => {
    expect(orderTrackingChannelName("a")).not.toBe(orderTrackingChannelName("b"));
  });
});

describe("computeDashboardMetrics — faturamento hoje", () => {
  it("soma somente pedidos válidos (não cancelados)", () => {
    const orders = [
      dashboardRow({ status: "delivered", total: 50 }),
      dashboardRow({ status: "preparing", total: 30 }),
    ];
    expect(computeDashboardMetrics(orders, 0).revenueToday).toBe(80);
  });

  it("BUG CORRIGIDO: pedido cancelado nunca entra no faturamento, mesmo tendo total > 0", () => {
    const orders = [dashboardRow({ status: "delivered", total: 50 }), dashboardRow({ status: "cancelled", total: 999 })];
    expect(computeDashboardMetrics(orders, 0).revenueToday).toBe(50);
  });

  it("sem pedidos válidos hoje: faturamento é 0, nunca NaN", () => {
    expect(computeDashboardMetrics([], 0).revenueToday).toBe(0);
    expect(computeDashboardMetrics([dashboardRow({ status: "cancelled", total: 100 })], 0).revenueToday).toBe(0);
  });
});

describe("computeDashboardMetrics — pedidos hoje", () => {
  it("conta TODOS os pedidos recebidos hoje, cancelados inclusive (é volume, não receita)", () => {
    const orders = [
      dashboardRow({ status: "delivered", total: 50 }),
      dashboardRow({ status: "cancelled", total: 30 }),
      dashboardRow({ status: "received", total: 20 }),
    ];
    expect(computeDashboardMetrics(orders, 0).ordersToday).toBe(3);
  });

  it("nenhum pedido hoje: 0, nunca undefined", () => {
    expect(computeDashboardMetrics([], 0).ordersToday).toBe(0);
  });
});

describe("computeDashboardMetrics — ticket médio", () => {
  it("faturamento dividido pela quantidade de pedidos VÁLIDOS (não pelo total de pedidos hoje)", () => {
    const orders = [
      dashboardRow({ status: "delivered", total: 100 }),
      dashboardRow({ status: "cancelled", total: 500 }), // não entra no numerador nem no denominador
    ];
    const metrics = computeDashboardMetrics(orders, 0);
    expect(metrics.averageTicketToday).toBe(100); // 100 / 1, não 600 / 2 nem 100 / 2
  });

  it("evita divisão por zero quando não há pedido válido hoje", () => {
    expect(computeDashboardMetrics([], 0).averageTicketToday).toBe(0);
    expect(computeDashboardMetrics([dashboardRow({ status: "cancelled", total: 40 })], 0).averageTicketToday).toBe(0);
  });
});

describe("computeDashboardMetrics — pedidos em andamento", () => {
  it("usa a contagem recebida do banco (independente da data), nunca recalcula a partir das linhas de hoje", () => {
    expect(computeDashboardMetrics([], 7).activeOrders).toBe(7);
  });
});

describe("computeDashboardMetrics — tempos médios", () => {
  it("null quando nenhum pedido hoje tem os dois timestamps (nunca 0 — 0 seria um dado errado)", () => {
    const metrics = computeDashboardMetrics([dashboardRow({ status: "preparing", total: 10 })], 0);
    expect(metrics.averagePrepMinutes).toBeNull();
    expect(metrics.averageDeliveryMinutes).toBeNull();
  });

  it("calcula o tempo médio de preparo a partir de preparing_at -> ready_at", () => {
    const orders = [
      dashboardRow({
        status: "ready",
        total: 10,
        preparing_at: "2026-09-09T12:00:00.000Z",
        ready_at: "2026-09-09T12:20:00.000Z",
      }),
    ];
    expect(computeDashboardMetrics(orders, 0).averagePrepMinutes).toBe(20);
  });
});

describe("getRecentOrders — isolamento por restaurante", () => {
  it("sempre filtra a query por restaurant_id, nunca confia em outro escopo", async () => {
    const { client, calls } = createFakeSupabase([]);
    await getRecentOrders(client, "restaurante-abc");
    expect(calls).toContainEqual({ method: "eq", args: ["restaurant_id", "restaurante-abc"] });
    expect(calls).toContainEqual({ method: "from", args: ["orders"] });
  });

  it("normaliza total (numeric do Postgres chega como string) para number", async () => {
    const { client } = createFakeSupabase([
      { id: "o1", order_number: 1, customer_name: "Maria", total: "45.90", status: "delivered", created_at: "2026-09-09T12:00:00.000Z" },
    ]);
    const orders = await getRecentOrders(client, "r1");
    expect(orders[0].total).toBe(45.9);
    expect(typeof orders[0].total).toBe("number");
  });
});

describe("cobertura completa da esteira de entrega e retirada (sanity)", () => {
  const deliverySteps: OrderStatus[] = ["received", "confirmed", "preparing", "ready", "out_for_delivery", "delivered"];
  it("percorre a esteira de entrega sem repetir nem pular", () => {
    for (let i = 0; i < deliverySteps.length - 1; i++) {
      expect(getNextOrderStatus(deliverySteps[i], "delivery")).toBe(deliverySteps[i + 1]);
    }
  });

  const pickupSteps: OrderStatus[] = ["received", "confirmed", "preparing", "ready", "picked_up"];
  it("percorre a esteira de retirada sem repetir nem pular", () => {
    for (let i = 0; i < pickupSteps.length - 1; i++) {
      expect(getNextOrderStatus(pickupSteps[i], "pickup")).toBe(pickupSteps[i + 1]);
    }
  });
});
