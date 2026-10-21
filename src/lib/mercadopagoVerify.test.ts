import { describe, expect, it } from "vitest";
import {
  debitDateToBrasiliaDate,
  isMercadoPagoCheckoutUrl,
  mercadoPagoPaymentOutcome,
  sameMpAmount,
  verifyMercadoPagoPaymentForEvent,
  verifyMercadoPagoPreapproval,
} from "./mercadopagoVerify";
import type { MercadoPagoAuthorizedPayment, MercadoPagoPreapproval } from "./mercadopago";

const REF = "11111111-1111-1111-1111-111111111111";
const preapproval = (over: Partial<MercadoPagoPreapproval> = {}): MercadoPagoPreapproval => ({
  id: "pre-1",
  status: "pending",
  external_reference: REF,
  auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 49.9, currency_id: "BRL" },
  ...over,
});
const expected = { amount: 49.9, externalReference: REF };

describe("sameMpAmount", () => {
  it("compara em centavos e aceita string numérica", () => {
    expect(sameMpAmount(49.9, "49.90")).toBe(true);
    expect(sameMpAmount(0.1 + 0.2, 0.3)).toBe(true);
    expect(sameMpAmount(49.9, 49.91)).toBe(false);
    expect(sameMpAmount("abc", 1)).toBe(false);
    expect(sameMpAmount(undefined, 1)).toBe(false);
  });
});

describe("verifyMercadoPagoPreapproval", () => {
  it("aceita assinatura pendente ou autorizada correta", () => {
    expect(verifyMercadoPagoPreapproval(preapproval(), expected)).toEqual({ ok: true });
    expect(verifyMercadoPagoPreapproval(preapproval({ status: "authorized" }), expected)).toEqual({ ok: true });
  });

  it("recusa id diferente, status fora do permitido e cancelada", () => {
    expect(verifyMercadoPagoPreapproval(preapproval(), { ...expected, preapprovalId: "outra" })).toEqual({
      ok: false,
      reason: "preapproval_id_mismatch",
    });
    expect(verifyMercadoPagoPreapproval(preapproval({ status: "cancelled" }), expected)).toEqual({
      ok: false,
      reason: "preapproval_status_not_allowed",
    });
    expect(verifyMercadoPagoPreapproval(preapproval({ status: "paused" }), expected)).toEqual({
      ok: false,
      reason: "preapproval_status_not_allowed",
    });
  });

  it("recusa referência, valor, moeda e frequência incorretos", () => {
    const recurring = (over: Record<string, unknown>) => ({
      frequency: 1,
      frequency_type: "months",
      transaction_amount: 49.9,
      currency_id: "BRL",
      ...over,
    });
    expect(verifyMercadoPagoPreapproval(preapproval({ external_reference: "x" }), expected)).toEqual({
      ok: false,
      reason: "reference_mismatch",
    });
    expect(verifyMercadoPagoPreapproval(preapproval({ auto_recurring: recurring({ transaction_amount: 10 }) }), expected)).toEqual({
      ok: false,
      reason: "amount_mismatch",
    });
    expect(verifyMercadoPagoPreapproval(preapproval({ auto_recurring: recurring({ currency_id: "USD" }) }), expected)).toEqual({
      ok: false,
      reason: "currency_mismatch",
    });
    expect(verifyMercadoPagoPreapproval(preapproval({ auto_recurring: recurring({ frequency: 12 }) }), expected)).toEqual({
      ok: false,
      reason: "frequency_mismatch",
    });
    expect(verifyMercadoPagoPreapproval(preapproval({ auto_recurring: null }), expected)).toEqual({
      ok: false,
      reason: "missing_recurrence",
    });
  });

  it("recusa objeto ausente", () => {
    expect(verifyMercadoPagoPreapproval(null, expected)).toEqual({ ok: false, reason: "missing_preapproval" });
  });
});

describe("debitDateToBrasiliaDate", () => {
  it("converte para o dia em Brasília (fuso -03)", () => {
    expect(debitDateToBrasiliaDate("2026-10-10T12:00:00.000-03:00")).toBe("2026-10-10");
    expect(debitDateToBrasiliaDate("2026-10-11T01:30:00.000Z")).toBe("2026-10-10"); // 22:30 do dia 10 em Brasília
    expect(debitDateToBrasiliaDate("2026-10-10T23:30:00.000-03:00")).toBe("2026-10-10");
  });
  it("devolve null para valor inválido", () => {
    expect(debitDateToBrasiliaDate("ontem")).toBeNull();
    expect(debitDateToBrasiliaDate(null)).toBeNull();
    expect(debitDateToBrasiliaDate(12345)).toBeNull();
  });
});

describe("isMercadoPagoCheckoutUrl", () => {
  it("só aceita https de domínio do Mercado Pago", () => {
    expect(isMercadoPagoCheckoutUrl("https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=1")).toBe(true);
    expect(isMercadoPagoCheckoutUrl("https://mercadopago.com/checkout")).toBe(true);
    expect(isMercadoPagoCheckoutUrl("http://www.mercadopago.com.br/x")).toBe(false);
    expect(isMercadoPagoCheckoutUrl("https://mercadopago.com.evil.example/x")).toBe(false);
    expect(isMercadoPagoCheckoutUrl("https://evilmercadopago.com/x")).toBe(false);
    expect(isMercadoPagoCheckoutUrl("javascript:alert(1)")).toBe(false);
    expect(isMercadoPagoCheckoutUrl(null)).toBe(false);
  });
});

const payment = (over: Partial<MercadoPagoAuthorizedPayment> = {}): MercadoPagoAuthorizedPayment => ({
  id: 777,
  preapproval_id: "pre-1",
  status: "processed",
  transaction_amount: 49.9,
  payment: { id: 1, status: "approved" },
  ...over,
});

describe("mercadoPagoPaymentOutcome", () => {
  it("só é paga com fatura processada E pagamento aprovado", () => {
    expect(mercadoPagoPaymentOutcome(payment())).toBe("paid");
    expect(mercadoPagoPaymentOutcome(payment({ status: "scheduled" }))).toBe("pending");
    expect(mercadoPagoPaymentOutcome(payment({ payment: { status: "pending" } }))).toBe("pending");
    expect(mercadoPagoPaymentOutcome(payment({ payment: null }))).toBe("pending");
  });

  it("classifica falha e cancelamento", () => {
    expect(mercadoPagoPaymentOutcome(payment({ payment: { status: "rejected" } }))).toBe("failed");
    expect(mercadoPagoPaymentOutcome(payment({ payment: { status: "charged_back" } }))).toBe("failed");
    expect(mercadoPagoPaymentOutcome(payment({ status: "cancelled" }))).toBe("cancelled");
    expect(mercadoPagoPaymentOutcome(null)).toBe("pending");
  });
});

describe("verifyMercadoPagoPaymentForEvent", () => {
  const event = { authorizedPaymentId: "777", preapprovalId: "pre-1" };

  it("aceita fatura paga da assinatura do evento", () => {
    expect(verifyMercadoPagoPaymentForEvent(payment(), event)).toEqual({ ok: true });
    expect(verifyMercadoPagoPaymentForEvent(payment({ id: "777" }), event)).toEqual({ ok: true });
  });

  it("recusa id, assinatura, valor e status incorretos", () => {
    expect(verifyMercadoPagoPaymentForEvent(payment({ id: 1 }), event)).toEqual({ ok: false, reason: "payment_id_mismatch" });
    expect(verifyMercadoPagoPaymentForEvent(payment({ preapproval_id: "outra" }), event)).toEqual({
      ok: false,
      reason: "subscription_mismatch",
    });
    expect(verifyMercadoPagoPaymentForEvent(payment({ transaction_amount: "x" }), event)).toEqual({
      ok: false,
      reason: "invalid_value",
    });
    expect(verifyMercadoPagoPaymentForEvent(payment({ status: "scheduled" }), event)).toEqual({
      ok: false,
      reason: "payment_not_paid",
    });
    expect(verifyMercadoPagoPaymentForEvent(undefined, event)).toEqual({ ok: false, reason: "missing_payment" });
  });
});
