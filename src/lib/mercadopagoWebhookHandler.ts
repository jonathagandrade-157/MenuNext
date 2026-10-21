/**
 * Lógica do webhook do Mercado Pago, separada da rota para ser testável
 * (arquivos `route.ts` só podem exportar handlers HTTP). Equivalente do
 * asaasWebhookHandler.ts, com as diferenças do provedor:
 *
 *  1. AUTENTICIDADE por assinatura HMAC (x-signature + x-request-id + data.id da
 *     query), verificada ANTES de ler o corpo, chamar a API ou tocar no banco.
 *     Sem segredo configurado: 503 (erro de configuração); assinatura inválida: 401.
 *  2. O corpo da notificação NÃO é assinado e só traz ids. Nada dele é aplicado:
 *     o recurso (assinatura ou fatura) é relido pela API autenticada do Mercado
 *     Pago e é essa leitura que o banco recebe (valor, status, vencimento).
 *  3. Fatura PAGA só vale se a leitura confirmar fatura processada E pagamento
 *     aprovado, da assinatura certa e com valor numérico.
 *  4. O banco decide o efeito (mapeamento, idempotência, ordem, vínculo). A
 *     função process_mercadopago_event só é executável pelo service_role.
 *
 * Responde 200 para tudo que reenvio não ajudaria; 503 quando a API do Mercado
 * Pago está indisponível e vale tentar de novo.
 */
import type { MercadoPagoAuthorizedPayment, MercadoPagoPreapproval, MercadoPagoResult } from "./mercadopago";
import {
  debitDateToBrasiliaDate,
  mercadoPagoPaymentOutcome,
  verifyMercadoPagoPaymentForEvent,
} from "./mercadopagoVerify";
import {
  getMercadoPagoSignatureTs,
  parseMercadoPagoWebhook,
  verifyMercadoPagoSignature,
  type MercadoPagoWebhookBody,
} from "./mercadopagoWebhook";

export type MercadoPagoWebhookDeps = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  getPreapproval(id: string): Promise<MercadoPagoResult<MercadoPagoPreapproval>>;
  getAuthorizedPayment(id: string): Promise<MercadoPagoResult<MercadoPagoAuthorizedPayment>>;
  /** MERCADOPAGO_WEBHOOK_SECRET. */
  secret: string | undefined;
  /** Há token da API para reler os recursos. */
  apiConfigured: boolean;
};

export type MercadoPagoWebhookRequest = {
  xSignature: string | null;
  xRequestId: string | null;
  /** `data.id` da QUERY da URL. */
  dataId: string | null;
  /** `type` (ou `topic`) da query. */
  topic: string | null;
  readBody: () => Promise<unknown>;
};

export type WebhookResponse = { status: number; body: Record<string, unknown> };

const UNVERIFIED = (reason: string): WebhookResponse => ({ status: 200, body: { ok: true, result: "unverified", reason } });

/** 4xx definitivo (não existe/sem permissão): não confirma e não insiste. Rede/5xx/429: tentar de novo. */
function failure(result: Extract<MercadoPagoResult<unknown>, { ok: false }>): WebhookResponse {
  const status = result.httpStatus;
  if (status !== undefined && status >= 400 && status < 500 && status !== 429) return UNVERIFIED("resource_not_found");
  return { status: 503, body: { error: "verification_unavailable" } };
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function amountOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(n) && n >= 0 && n < 1_000_000 ? n : null;
}

export async function handleMercadoPagoWebhook(
  request: MercadoPagoWebhookRequest,
  deps: MercadoPagoWebhookDeps
): Promise<WebhookResponse> {
  if (!deps.secret) return { status: 503, body: { error: "not_configured" } };

  const authentic = verifyMercadoPagoSignature({
    xSignature: request.xSignature,
    xRequestId: request.xRequestId,
    dataId: request.dataId,
    secret: deps.secret,
  });
  if (!authentic) return { status: 401, body: { error: "not_authorized" } };

  let body: MercadoPagoWebhookBody & { date_created?: unknown };
  try {
    body = (await request.readBody()) as MercadoPagoWebhookBody & { date_created?: unknown };
  } catch {
    return { status: 400, body: { error: "invalid_payload" } };
  }

  const event = parseMercadoPagoWebhook(body, {
    dataId: request.dataId,
    topic: request.topic,
    ts: getMercadoPagoSignatureTs(request.xSignature),
  });
  if (!event) return { status: 200, body: { ok: true, ignored: true } };

  if (!deps.apiConfigured) return UNVERIFIED("cannot_verify");

  const occurredAt = isoOrNull(body?.date_created);

  if (event.kind === "preapproval") {
    const preapproval = await deps.getPreapproval(event.resourceId);
    if (!preapproval.ok) return failure(preapproval);
    const sub = preapproval.data;
    if (String(sub.id) !== event.resourceId) return UNVERIFIED("preapproval_id_mismatch");
    const reference = typeof sub.external_reference === "string" ? sub.external_reference : "";
    if (!reference) return UNVERIFIED("missing_reference");

    return applyEvent(deps, {
      p_event_id: event.eventId,
      p_event_kind: "preapproval",
      p_occurred_at: occurredAt,
      p_subscription_ref: sub.id,
      p_customer_ref: reference,
      p_external_ref: reference,
      p_subscription_status: typeof sub.status === "string" ? sub.status : null,
      p_payment_ref: null,
      p_payment_status: null,
      p_amount: null,
      p_due_date: null,
      p_paid_at: null,
    });
  }

  // Fatura (cobrança) da assinatura.
  const invoice = await deps.getAuthorizedPayment(event.resourceId);
  if (!invoice.ok) return failure(invoice);
  const payment = invoice.data;
  if (String(payment.id) !== event.resourceId) return UNVERIFIED("payment_id_mismatch");
  if (typeof payment.preapproval_id !== "string" || !payment.preapproval_id) return UNVERIFIED("missing_subscription");

  // A referência do MenuNext vem da assinatura (a fatura não a carrega).
  const parent = await deps.getPreapproval(payment.preapproval_id);
  if (!parent.ok) return failure(parent);
  const sub = parent.data;
  if (String(sub.id) !== payment.preapproval_id) return UNVERIFIED("preapproval_id_mismatch");
  const reference = typeof sub.external_reference === "string" ? sub.external_reference : "";
  if (!reference) return UNVERIFIED("missing_reference");

  if (mercadoPagoPaymentOutcome(payment) === "paid") {
    const verdict = verifyMercadoPagoPaymentForEvent(payment, {
      authorizedPaymentId: event.resourceId,
      preapprovalId: sub.id,
    });
    if (!verdict.ok) return UNVERIFIED(verdict.reason);
  }

  return applyEvent(deps, {
    p_event_id: event.eventId,
    p_event_kind: "authorized_payment",
    p_occurred_at: occurredAt,
    p_subscription_ref: sub.id,
    p_customer_ref: reference,
    p_external_ref: reference,
    p_subscription_status: null,
    p_payment_ref: String(payment.id),
    // Status combinado "<fatura>/<pagamento>"; o BANCO decide o que significa.
    p_payment_status: `${payment.status}/${payment.payment?.status ?? ""}`,
    p_amount: amountOrNull(payment.transaction_amount),
    p_due_date: debitDateToBrasiliaDate(payment.debit_date),
    p_paid_at: null,
  });
}

async function applyEvent(deps: MercadoPagoWebhookDeps, args: Record<string, unknown>): Promise<WebhookResponse> {
  const { data, error } = await deps.rpc("process_mercadopago_event", args);
  if (error) {
    if (error.message.toLowerCase().includes("invalid_event")) return { status: 400, body: { error: "invalid_event" } };
    return { status: 500, body: { error: "processing_failed" } };
  }
  return { status: 200, body: { ok: true, result: data } };
}
