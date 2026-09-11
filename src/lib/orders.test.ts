import { describe, expect, it } from "vitest";
import {
  getKanbanColumnForStatus,
  getNextOrderStatus,
  isTerminalOrderStatus,
  orderTrackingChannelName,
  type OrderStatus,
} from "./orders";

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
