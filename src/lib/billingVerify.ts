/**
 * Verificações PURAS sobre objetos lidos da API autenticada do Asaas. Nada aqui
 * fala com a rede nem com o banco: recebe o que o servidor leu e diz se confere
 * com o que o MenuNext esperava. Quem chama decide o que fazer com o veredito.
 */
import type { AsaasPaymentDetail, AsaasSubscriptionDetail } from "./asaas";

export type Verdict = { ok: true } | { ok: false; reason: string };

/** Compara valores monetários em centavos (evita erro de ponto flutuante). */
export function sameAmount(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.round(a * 100) === Math.round(b * 100);
}

/**
 * A assinatura que o servidor acabou de criar (ou reencontrou) no Asaas é
 * realmente a esperada: ativa, não removida, do cliente certo, com o valor do
 * plano e com a referência do MenuNext.
 */
export function verifyAsaasSubscription(
  subscription: AsaasSubscriptionDetail | null | undefined,
  expected: { subscriptionId?: string; customerId: string; amount: number; externalReference: string }
): Verdict {
  if (!subscription || typeof subscription.id !== "string") return { ok: false, reason: "missing_subscription" };
  if (expected.subscriptionId && subscription.id !== expected.subscriptionId) return { ok: false, reason: "subscription_id_mismatch" };
  if (subscription.deleted) return { ok: false, reason: "subscription_deleted" };
  if (subscription.status !== "ACTIVE") return { ok: false, reason: "subscription_not_active" };
  if (subscription.customer !== expected.customerId) return { ok: false, reason: "customer_mismatch" };
  if (!sameAmount(subscription.value, expected.amount)) return { ok: false, reason: "amount_mismatch" };
  if (subscription.externalReference !== expected.externalReference) return { ok: false, reason: "reference_mismatch" };
  return { ok: true };
}

const PAID_STATUSES = new Set(["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"]);

/** A cobrança está paga no Asaas (usado para conferir um evento de confirmação). */
export function isAsaasPaidStatus(status: unknown): boolean {
  return typeof status === "string" && PAID_STATUSES.has(status);
}

/**
 * Antes de liberar acesso por um evento PAYMENT_CONFIRMED/RECEIVED, a cobrança
 * lida na API tem de ser a mesma do evento, da mesma assinatura e do mesmo
 * cliente, e estar paga de fato.
 */
export function verifyAsaasPaymentForEvent(
  payment: AsaasPaymentDetail | null | undefined,
  event: { paymentId: string; subscriptionId: string; customerId: string | null }
): Verdict {
  if (!payment || typeof payment.id !== "string") return { ok: false, reason: "missing_payment" };
  if (payment.id !== event.paymentId) return { ok: false, reason: "payment_id_mismatch" };
  if (payment.deleted) return { ok: false, reason: "payment_deleted" };
  if (payment.subscription !== event.subscriptionId) return { ok: false, reason: "subscription_mismatch" };
  if (event.customerId !== null && payment.customer !== event.customerId) return { ok: false, reason: "customer_mismatch" };
  if (!isAsaasPaidStatus(payment.status)) return { ok: false, reason: "payment_not_paid" };
  if (typeof payment.value !== "number" || !Number.isFinite(payment.value)) return { ok: false, reason: "invalid_value" };
  return { ok: true };
}

/** `YYYY-MM-DD` ou null. */
export function dateOnly(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
