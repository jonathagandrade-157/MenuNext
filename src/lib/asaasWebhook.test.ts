import { describe, expect, it } from "vitest";
import { resolveSubscriptionStatusChange } from "./asaasWebhook";

describe("resolveSubscriptionStatusChange — pagamento da assinatura", () => {
  it("PAYMENT_CONFIRMED e PAYMENT_RECEIVED liberam a assinatura (active)", () => {
    for (const event of ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"]) {
      const change = resolveSubscriptionStatusChange({
        id: "evt_1",
        event,
        payment: { id: "pay_1", subscription: "sub_1" },
      });
      expect(change).toEqual({ status: "active", subscriptionId: "sub_1", eventId: "evt_1" });
    }
  });

  it("PAYMENT_OVERDUE marca como atrasada (overdue)", () => {
    const change = resolveSubscriptionStatusChange({
      id: "evt_2",
      event: "PAYMENT_OVERDUE",
      payment: { id: "pay_1", subscription: "sub_1" },
    });
    expect(change?.status).toBe("overdue");
  });

  it("cobrança avulsa (sem assinatura) é ignorada", () => {
    expect(
      resolveSubscriptionStatusChange({ id: "evt_3", event: "PAYMENT_OVERDUE", payment: { id: "pay_9" } })
    ).toBeNull();
  });
});

describe("resolveSubscriptionStatusChange — eventos que NÃO podem bloquear a loja", () => {
  it("excluir ou estornar uma única cobrança não cancela a assinatura", () => {
    for (const event of ["PAYMENT_DELETED", "PAYMENT_REFUNDED", "PAYMENT_PARTIALLY_REFUNDED", "PAYMENT_CHARGEBACK_REQUESTED"]) {
      expect(
        resolveSubscriptionStatusChange({ id: "evt_4", event, payment: { id: "pay_1", subscription: "sub_1" } })
      ).toBeNull();
    }
  });

  it("eventos informativos são ignorados", () => {
    for (const event of ["PAYMENT_CREATED", "PAYMENT_UPDATED", "SUBSCRIPTION_CREATED", "SUBSCRIPTION_UPDATED", "toString"]) {
      expect(
        resolveSubscriptionStatusChange({
          id: "evt_5",
          event,
          payment: { id: "pay_1", subscription: "sub_1" },
          subscription: { id: "sub_1" },
        })
      ).toBeNull();
    }
  });

  it("payload sem evento é ignorado", () => {
    expect(resolveSubscriptionStatusChange({})).toBeNull();
  });
});

describe("resolveSubscriptionStatusChange — cancelamento da assinatura", () => {
  it("SUBSCRIPTION_DELETED e SUBSCRIPTION_INACTIVATED cancelam usando subscription.id", () => {
    for (const event of ["SUBSCRIPTION_DELETED", "SUBSCRIPTION_INACTIVATED"]) {
      const change = resolveSubscriptionStatusChange({ id: "evt_6", event, subscription: { id: "sub_7" } });
      expect(change).toEqual({ status: "cancelled", subscriptionId: "sub_7", eventId: "evt_6" });
    }
  });

  it("cancelamento sem id de assinatura é ignorado", () => {
    expect(resolveSubscriptionStatusChange({ id: "evt_7", event: "SUBSCRIPTION_DELETED" })).toBeNull();
  });
});

describe("resolveSubscriptionStatusChange — idempotência", () => {
  it("usa o id do evento do Asaas, então o mesmo evento repetido tem a mesma chave", () => {
    const body = { id: "evt_8", event: "PAYMENT_OVERDUE", payment: { id: "pay_1", subscription: "sub_1" } };
    expect(resolveSubscriptionStatusChange(body)?.eventId).toBe(resolveSubscriptionStatusChange(body)?.eventId);
  });

  it("dois eventos distintos do mesmo pagamento têm chaves distintas", () => {
    const first = resolveSubscriptionStatusChange({
      id: "evt_a",
      event: "PAYMENT_OVERDUE",
      payment: { id: "pay_1", subscription: "sub_1" },
    });
    const second = resolveSubscriptionStatusChange({
      id: "evt_b",
      event: "PAYMENT_OVERDUE",
      payment: { id: "pay_1", subscription: "sub_1" },
    });
    expect(first?.eventId).not.toBe(second?.eventId);
  });

  it("sem id de topo, cai no fallback composto por evento + pagamento", () => {
    const change = resolveSubscriptionStatusChange({
      event: "PAYMENT_CONFIRMED",
      payment: { id: "pay_1", subscription: "sub_1" },
    });
    expect(change?.eventId).toBe("PAYMENT_CONFIRMED:pay_1");
  });
});
