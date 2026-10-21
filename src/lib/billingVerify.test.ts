import { describe, expect, it } from "vitest";
import {
  isAsaasPaidStatus,
  sameAmount,
  verifyAsaasPaymentForEvent,
  verifyAsaasSubscription,
} from "./billingVerify";
import type { AsaasPaymentDetail, AsaasSubscriptionDetail } from "./asaas";

const sub = (extra: Partial<AsaasSubscriptionDetail> = {}): AsaasSubscriptionDetail => ({
  id: "sub_1",
  customer: "cus_1",
  value: 49.9,
  status: "ACTIVE",
  externalReference: "ref-interna-1",
  deleted: false,
  ...extra,
});

const expectedSub = { subscriptionId: "sub_1", customerId: "cus_1", amount: 49.9, externalReference: "ref-interna-1" };

describe("sameAmount", () => {
  it("compara em centavos, sem erro de ponto flutuante", () => {
    expect(sameAmount(49.9, 49.9)).toBe(true);
    expect(sameAmount(0.1 + 0.2, 0.3)).toBe(true);
    expect(sameAmount(49.9, 49.91)).toBe(false);
    expect(sameAmount(Number.NaN, 1)).toBe(false);
    expect(sameAmount(Infinity, Infinity)).toBe(false);
  });
});

describe("verifyAsaasSubscription — prova de origem antes de registrar os ids", () => {
  it("aceita a assinatura ativa, do cliente certo, com o valor do plano e a referência do MenuNext", () => {
    expect(verifyAsaasSubscription(sub(), expectedSub)).toEqual({ ok: true });
  });

  it("recusa assinatura de OUTRA tentativa (referência diferente) ou sem referência", () => {
    expect(verifyAsaasSubscription(sub({ externalReference: "ref-de-outro" }), expectedSub)).toEqual({ ok: false, reason: "reference_mismatch" });
    expect(verifyAsaasSubscription(sub({ externalReference: null }), expectedSub)).toEqual({ ok: false, reason: "reference_mismatch" });
  });

  it("recusa assinatura de OUTRO cliente do Asaas", () => {
    expect(verifyAsaasSubscription(sub({ customer: "cus_outro" }), expectedSub)).toEqual({ ok: false, reason: "customer_mismatch" });
  });

  it("recusa valor diferente do plano (maior ou menor)", () => {
    expect(verifyAsaasSubscription(sub({ value: 10 }), expectedSub)).toEqual({ ok: false, reason: "amount_mismatch" });
    expect(verifyAsaasSubscription(sub({ value: 500 }), expectedSub)).toEqual({ ok: false, reason: "amount_mismatch" });
  });

  it("recusa assinatura removida, inativa ou expirada", () => {
    expect(verifyAsaasSubscription(sub({ deleted: true }), expectedSub)).toEqual({ ok: false, reason: "subscription_deleted" });
    expect(verifyAsaasSubscription(sub({ status: "INACTIVE" }), expectedSub)).toEqual({ ok: false, reason: "subscription_not_active" });
    expect(verifyAsaasSubscription(sub({ status: "EXPIRED" }), expectedSub)).toEqual({ ok: false, reason: "subscription_not_active" });
  });

  it("recusa id diferente do esperado e resposta ausente", () => {
    expect(verifyAsaasSubscription(sub({ id: "sub_2" }), expectedSub)).toEqual({ ok: false, reason: "subscription_id_mismatch" });
    expect(verifyAsaasSubscription(null, expectedSub)).toEqual({ ok: false, reason: "missing_subscription" });
    expect(verifyAsaasSubscription(undefined, expectedSub)).toEqual({ ok: false, reason: "missing_subscription" });
  });
});

const pay = (extra: Partial<AsaasPaymentDetail> = {}): AsaasPaymentDetail => ({
  id: "pay_1",
  customer: "cus_1",
  subscription: "sub_1",
  value: 49.9,
  status: "CONFIRMED",
  dueDate: "2026-10-10",
  paymentDate: "2026-10-09",
  deleted: false,
  ...extra,
});

const ev = { paymentId: "pay_1", subscriptionId: "sub_1", customerId: "cus_1" };

describe("isAsaasPaidStatus", () => {
  it("só status de pagamento efetivo contam", () => {
    for (const s of ["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"]) expect(isAsaasPaidStatus(s)).toBe(true);
    for (const s of ["PENDING", "OVERDUE", "REFUNDED", "CHARGEBACK_REQUESTED", "AWAITING_RISK_ANALYSIS", "", null, 3]) {
      expect(isAsaasPaidStatus(s)).toBe(false);
    }
  });
});

describe("verifyAsaasPaymentForEvent — evento de confirmação só vale se a API do Asaas concordar", () => {
  it("aceita cobrança paga, da mesma assinatura e do mesmo cliente", () => {
    expect(verifyAsaasPaymentForEvent(pay(), ev)).toEqual({ ok: true });
    expect(verifyAsaasPaymentForEvent(pay({ status: "RECEIVED" }), ev)).toEqual({ ok: true });
  });

  it("recusa evento FORJADO: a API diz que a cobrança ainda está pendente, atrasada ou estornada", () => {
    for (const status of ["PENDING", "OVERDUE", "REFUNDED", "CHARGEBACK_REQUESTED"]) {
      expect(verifyAsaasPaymentForEvent(pay({ status }), ev)).toEqual({ ok: false, reason: "payment_not_paid" });
    }
  });

  it("recusa cobrança de outra assinatura, de outro cliente, sem assinatura ou removida", () => {
    expect(verifyAsaasPaymentForEvent(pay({ subscription: "sub_2" }), ev)).toEqual({ ok: false, reason: "subscription_mismatch" });
    expect(verifyAsaasPaymentForEvent(pay({ subscription: null }), ev)).toEqual({ ok: false, reason: "subscription_mismatch" });
    expect(verifyAsaasPaymentForEvent(pay({ customer: "cus_2" }), ev)).toEqual({ ok: false, reason: "customer_mismatch" });
    expect(verifyAsaasPaymentForEvent(pay({ deleted: true }), ev)).toEqual({ ok: false, reason: "payment_deleted" });
    expect(verifyAsaasPaymentForEvent(pay({ id: "pay_2" }), ev)).toEqual({ ok: false, reason: "payment_id_mismatch" });
  });

  it("recusa valor inválido e resposta ausente", () => {
    expect(verifyAsaasPaymentForEvent(pay({ value: Number.NaN }), ev)).toEqual({ ok: false, reason: "invalid_value" });
    expect(verifyAsaasPaymentForEvent(null, ev)).toEqual({ ok: false, reason: "missing_payment" });
  });
});
