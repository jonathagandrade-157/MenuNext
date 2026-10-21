/**
 * Verificações PURAS sobre objetos lidos da API autenticada do Mercado Pago —
 * equivalente do billingVerify.ts do Asaas. Nada aqui fala com rede ou banco.
 */
import type { MercadoPagoAuthorizedPayment, MercadoPagoPreapproval } from "./mercadopago";

export type MpVerdict = { ok: true } | { ok: false; reason: string };

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

/** Compara valores em centavos (evita erro de ponto flutuante). */
export function sameMpAmount(a: unknown, b: unknown): boolean {
  const x = toNumber(a);
  const y = toNumber(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.round(x * 100) === Math.round(y * 100);
}

/** Status de uma assinatura (preapproval) que o MenuNext reconhece. */
export const MP_PREAPPROVAL_STATUSES = ["pending", "authorized", "paused", "cancelled"] as const;

/**
 * A assinatura que o servidor acabou de criar (ou reencontrou) no Mercado Pago é
 * a esperada: do plano certo (valor mensal em BRL), com a referência do
 * MenuNext e ainda pendente de autorização do pagador (ou já autorizada).
 */
export function verifyMercadoPagoPreapproval(
  preapproval: MercadoPagoPreapproval | null | undefined,
  expected: { preapprovalId?: string; amount: number; externalReference: string; allowStatuses?: readonly string[] }
): MpVerdict {
  if (!preapproval || typeof preapproval.id !== "string" || preapproval.id.length === 0) {
    return { ok: false, reason: "missing_preapproval" };
  }
  if (expected.preapprovalId && preapproval.id !== expected.preapprovalId) return { ok: false, reason: "preapproval_id_mismatch" };
  const allowed = expected.allowStatuses ?? ["pending", "authorized"];
  if (!allowed.includes(preapproval.status)) return { ok: false, reason: "preapproval_status_not_allowed" };
  if (preapproval.external_reference !== expected.externalReference) return { ok: false, reason: "reference_mismatch" };
  const recurring = preapproval.auto_recurring;
  if (!recurring) return { ok: false, reason: "missing_recurrence" };
  if (!sameMpAmount(recurring.transaction_amount, expected.amount)) return { ok: false, reason: "amount_mismatch" };
  if (recurring.currency_id !== "BRL") return { ok: false, reason: "currency_mismatch" };
  if (recurring.frequency !== 1 || recurring.frequency_type !== "months") return { ok: false, reason: "frequency_mismatch" };
  return { ok: true };
}

// Domínios do Mercado Pago (com subdomínios): .com e os países em que opera. Lista
// fechada de propósito — um "mercadopago.com.qualquer.coisa" não passa.
const CHECKOUT_HOST = /^(?:[a-z0-9-]+\.)*mercadopago\.com(?:\.(?:br|ar|mx|co|cl|pe|uy|ve))?$/;

/** O link de pagamento devolvido precisa ser HTTPS de um domínio do Mercado Pago. */
export function isMercadoPagoCheckoutUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && CHECKOUT_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Data de vencimento da fatura (dia, no fuso de Brasília) a partir do
 * `debit_date` ISO do Mercado Pago. O período pago é derivado deste dia.
 */
export function debitDateToBrasiliaDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return /^\d{4}-\d{2}-\d{2}$/.test(parts) ? parts : null;
}

export type MpPaymentOutcome = "paid" | "pending" | "failed" | "cancelled";

/**
 * Resultado de uma cobrança da assinatura. Só conta como PAGA quando a fatura
 * está processada E o pagamento vinculado foi aprovado — nunca por um dos dois.
 */
export function mercadoPagoPaymentOutcome(payment: MercadoPagoAuthorizedPayment | null | undefined): MpPaymentOutcome {
  if (!payment) return "pending";
  if (payment.status === "cancelled") return "cancelled";
  const linked = payment.payment?.status;
  if (payment.status === "processed" && linked === "approved") return "paid";
  if (linked === "rejected" || linked === "cancelled" || linked === "charged_back" || linked === "refunded") return "failed";
  return "pending";
}

/**
 * Antes de liberar acesso por um evento de pagamento, a fatura lida na API tem
 * de ser a do evento, da assinatura conhecida, com valor válido e PAGA de fato.
 */
export function verifyMercadoPagoPaymentForEvent(
  payment: MercadoPagoAuthorizedPayment | null | undefined,
  event: { authorizedPaymentId: string; preapprovalId: string }
): MpVerdict {
  if (!payment || (typeof payment.id !== "string" && typeof payment.id !== "number")) return { ok: false, reason: "missing_payment" };
  if (String(payment.id) !== event.authorizedPaymentId) return { ok: false, reason: "payment_id_mismatch" };
  if (payment.preapproval_id !== event.preapprovalId) return { ok: false, reason: "subscription_mismatch" };
  if (!Number.isFinite(toNumber(payment.transaction_amount))) return { ok: false, reason: "invalid_value" };
  if (mercadoPagoPaymentOutcome(payment) !== "paid") return { ok: false, reason: "payment_not_paid" };
  return { ok: true };
}
