import { describe, expect, it } from "vitest";
import { parseAsaasWebhook } from "./asaasWebhook";

const payment = (extra: Record<string, unknown> = {}) => ({
  id: "pay_1",
  customer: "cus_1",
  subscription: "sub_1",
  value: 49.9,
  dueDate: "2026-10-10",
  paymentDate: "2026-10-09",
  ...extra,
});

describe("parseAsaasWebhook — eventos de pagamento da assinatura", () => {
  it("extrai os campos que o banco usa para verificar assinatura, cliente e valor", () => {
    const params = parseAsaasWebhook({
      id: "evt_1",
      event: "PAYMENT_CONFIRMED",
      dateCreated: "2026-10-09 15:30:00",
      payment: payment(),
    });
    expect(params).toEqual({
      eventId: "evt_1",
      eventType: "PAYMENT_CONFIRMED",
      occurredAt: "2026-10-09T18:30:00.000Z",
      subscriptionId: "sub_1",
      customerId: "cus_1",
      paymentId: "pay_1",
      value: 49.9,
      dueDate: "2026-10-10",
      paidAt: "2026-10-09",
      externalReference: null,
    });
  });

  it("reconhece os eventos de pagamento tratados pelo banco", () => {
    for (const event of [
      "PAYMENT_CREATED",
      "PAYMENT_CONFIRMED",
      "PAYMENT_RECEIVED",
      "PAYMENT_OVERDUE",
      "PAYMENT_REFUNDED",
      "PAYMENT_DELETED",
      "PAYMENT_RESTORED",
      "PAYMENT_CHARGEBACK_REQUESTED",
    ]) {
      expect(parseAsaasWebhook({ id: "evt_2", event, payment: payment() })?.eventType).toBe(event);
    }
  });

  it("cobrança avulsa (sem assinatura) é ignorada", () => {
    expect(
      parseAsaasWebhook({ id: "evt_3", event: "PAYMENT_OVERDUE", payment: { id: "pay_9", customer: "cus_1" } })
    ).toBeNull();
  });

  it("não decide status: o payload nunca carrega um 'status' escolhido pelo chamador", () => {
    const params = parseAsaasWebhook({
      id: "evt_4",
      event: "PAYMENT_OVERDUE",
      payment: payment(),
      status: "active",
    } as never);
    expect(params).not.toBeNull();
    expect(Object.keys(params!)).not.toContain("status");
  });
});

describe("parseAsaasWebhook — eventos que não são tratados", () => {
  it("eventos informativos ou desconhecidos são ignorados", () => {
    for (const event of [
      "PAYMENT_UPDATED",
      "PAYMENT_PARTIALLY_REFUNDED",
      "PAYMENT_CHARGEBACK_DISPUTE",
      "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
      "SUBSCRIPTION_CREATED",
      "SUBSCRIPTION_UPDATED",
      "toString",
      "__proto__",
    ]) {
      expect(
        parseAsaasWebhook({ id: "evt_5", event, payment: payment(), subscription: { id: "sub_1", customer: "cus_1" } })
      ).toBeNull();
    }
  });

  it("payload sem evento, sem id de evento ou inválido é ignorado", () => {
    expect(parseAsaasWebhook({})).toBeNull();
    expect(parseAsaasWebhook({ event: "PAYMENT_CONFIRMED", payment: payment() })).toBeNull();
    expect(parseAsaasWebhook({ id: "evt_6", payment: payment() })).toBeNull();
    expect(parseAsaasWebhook(null)).toBeNull();
    expect(parseAsaasWebhook(undefined)).toBeNull();
  });
});

describe("parseAsaasWebhook — tipos suspeitos viram null em vez de passar adiante", () => {
  it("valor não numérico, negativo ou absurdo é descartado", () => {
    for (const value of ["49.90", -1, Number.NaN, Infinity, 1e9, null, {}]) {
      const params = parseAsaasWebhook({ id: "evt_7", event: "PAYMENT_CONFIRMED", payment: payment({ value }) });
      expect(params?.value).toBeNull();
    }
  });

  it("datas fora do formato esperado são descartadas", () => {
    const params = parseAsaasWebhook({
      id: "evt_8",
      event: "PAYMENT_CONFIRMED",
      dateCreated: "ontem",
      payment: payment({ dueDate: "10/10/2026", paymentDate: "2026-13-45'; drop table x;--" }),
    });
    expect(params?.occurredAt).toBeNull();
    expect(params?.dueDate).toBeNull();
    expect(params?.paidAt).toBeNull();
  });

  it("ids que não são texto ou são grandes demais são descartados", () => {
    expect(parseAsaasWebhook({ id: 123 as never, event: "PAYMENT_CONFIRMED", payment: payment() })).toBeNull();
    expect(
      parseAsaasWebhook({ id: "evt_9", event: "PAYMENT_CONFIRMED", payment: payment({ subscription: "s".repeat(500) }) })
    ).toBeNull();
    expect(parseAsaasWebhook({ id: "evt_9", event: "PAYMENT_CONFIRMED", payment: payment({ customer: 7 }) })?.customerId).toBeNull();
  });
});

describe("parseAsaasWebhook — cancelamento da assinatura", () => {
  it("SUBSCRIPTION_DELETED e SUBSCRIPTION_INACTIVATED usam subscription.id e o cliente", () => {
    for (const event of ["SUBSCRIPTION_DELETED", "SUBSCRIPTION_INACTIVATED"]) {
      const params = parseAsaasWebhook({
        id: "evt_10",
        event,
        subscription: { id: "sub_7", customer: "cus_7", externalReference: "ref-7" },
      });
      expect(params).toMatchObject({
        eventType: event,
        subscriptionId: "sub_7",
        customerId: "cus_7",
        externalReference: "ref-7",
        paymentId: null,
        value: null,
      });
    }
  });

  it("cancelamento sem id de assinatura é ignorado", () => {
    expect(parseAsaasWebhook({ id: "evt_11", event: "SUBSCRIPTION_DELETED" })).toBeNull();
  });
});

describe("parseAsaasWebhook — idempotência", () => {
  it("usa o id do evento do Asaas, então o mesmo evento repetido tem a mesma chave", () => {
    const body = { id: "evt_12", event: "PAYMENT_OVERDUE", payment: payment() };
    expect(parseAsaasWebhook(body)?.eventId).toBe(parseAsaasWebhook(body)?.eventId);
  });

  it("dois eventos distintos do mesmo pagamento têm chaves distintas", () => {
    const first = parseAsaasWebhook({ id: "evt_a", event: "PAYMENT_OVERDUE", payment: payment() });
    const second = parseAsaasWebhook({ id: "evt_b", event: "PAYMENT_OVERDUE", payment: payment() });
    expect(first?.eventId).not.toBe(second?.eventId);
  });
});
