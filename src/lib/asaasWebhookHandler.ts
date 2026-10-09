/**
 * Lógica do webhook do Asaas, separada da rota para ser testável (arquivos
 * `route.ts` só podem exportar handlers HTTP).
 *
 * Ordem das defesas:
 *  1. Token do header `asaas-access-token` obrigatório e conferido pelo BANCO
 *     (comparação por digest) ANTES de qualquer outra coisa: quem não tem o
 *     token não faz o servidor ler payload, chamar o Asaas nem tocar em dados.
 *  2. Payload ilegível -> 400; evento que não interessa -> 200 (ignorado).
 *  3. Evento de CONFIRMAÇÃO (PAYMENT_CONFIRMED/RECEIVED) só vale se a API
 *     autenticada do Asaas concordar que a cobrança está paga, é da mesma
 *     assinatura e do mesmo cliente. Os valores aplicados vêm da API, não do
 *     payload. Sem a chave do Asaas, falha FECHADO (não libera nada).
 *  4. O banco decide o efeito do evento (mapeamento, idempotência, ordem).
 *
 * Responde 200 para tudo que reenvio não ajudaria (o Asaas pausa a fila após
 * falhas seguidas); 503 só quando a API do Asaas está indisponível e vale tentar
 * de novo.
 */
import type { AsaasPaymentDetail, AsaasResult } from "./asaas";
import { parseAsaasWebhook, type AsaasWebhookBody } from "./asaasWebhook";
import { dateOnly, verifyAsaasPaymentForEvent } from "./billingVerify";

export type WebhookDeps = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  getPayment(id: string): Promise<AsaasResult<AsaasPaymentDetail>>;
  asaasConfigured: boolean;
};

export type WebhookResponse = { status: number; body: Record<string, unknown> };

const CONFIRM_EVENTS = new Set(["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"]);

export async function handleAsaasWebhook(
  token: string | null,
  readBody: () => Promise<unknown>,
  deps: WebhookDeps
): Promise<WebhookResponse> {
  if (!token) return { status: 401, body: { error: "missing_token" } };

  const valid = await deps.rpc("billing_webhook_token_valid", { p_webhook_token: token });
  if (valid.error) return { status: 500, body: { error: "processing_failed" } };
  if (valid.data !== true) return { status: 401, body: { error: "not_authorized" } };

  let body: AsaasWebhookBody;
  try {
    body = (await readBody()) as AsaasWebhookBody;
  } catch {
    return { status: 400, body: { error: "invalid_payload" } };
  }

  const event = parseAsaasWebhook(body);
  if (!event) return { status: 200, body: { ok: true, ignored: true } };

  let { customerId, value, dueDate, paidAt } = event;

  if (CONFIRM_EVENTS.has(event.eventType)) {
    if (!deps.asaasConfigured || !event.paymentId) {
      return { status: 200, body: { ok: true, result: "unverified", reason: "cannot_verify" } };
    }
    const payment = await deps.getPayment(event.paymentId);
    if (!payment.ok) {
      // 4xx definitivo (não existe / sem permissão): não confirma e não insiste.
      // Rede ou 5xx do Asaas: devolve 503 para o Asaas reenviar depois.
      if (payment.httpStatus !== undefined && payment.httpStatus >= 400 && payment.httpStatus < 500 && payment.httpStatus !== 429) {
        return { status: 200, body: { ok: true, result: "unverified", reason: "payment_not_found" } };
      }
      return { status: 503, body: { error: "verification_unavailable" } };
    }
    const verdict = verifyAsaasPaymentForEvent(payment.data, {
      paymentId: event.paymentId,
      subscriptionId: event.subscriptionId,
      customerId: event.customerId,
    });
    if (!verdict.ok) {
      return { status: 200, body: { ok: true, result: "unverified", reason: verdict.reason } };
    }
    customerId = payment.data.customer;
    value = payment.data.value;
    dueDate = dateOnly(payment.data.dueDate) ?? event.dueDate;
    paidAt = dateOnly(payment.data.paymentDate) ?? event.paidAt;
  }

  const { data, error } = await deps.rpc("process_asaas_webhook", {
    p_webhook_token: token,
    p_event_id: event.eventId,
    p_event_type: event.eventType,
    p_occurred_at: event.occurredAt,
    p_subscription_id: event.subscriptionId,
    p_customer_id: customerId,
    p_payment_id: event.paymentId,
    p_value: value,
    p_due_date: dueDate,
    p_paid_at: paidAt,
    p_external_reference: event.externalReference,
  });

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("not_authorized")) return { status: 401, body: { error: "not_authorized" } };
    if (message.includes("invalid_event")) return { status: 400, body: { error: "invalid_event" } };
    return { status: 500, body: { error: "processing_failed" } };
  }
  return { status: 200, body: { ok: true, result: data } };
}
