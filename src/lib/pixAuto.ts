/**
 * Pix com confirmação automática — Mercado Pago da PRÓPRIA loja (o dinheiro cai direto na conta dela).
 * SÓ SERVIDOR. DESLIGADO por padrão: só funciona com TODAS as condições abaixo (`getPixAutoConfig`):
 *   PIX_AUTO_ENABLED=true, chave de cifra (32 bytes base64, ver secretBox.ts), PIX_PAYER_EMAIL, service_role configurada.
 * E, em cada loja, o OWNER precisa colar o token e LIGAR o recurso no painel.
 *
 * Confirmação: nunca a partir do que o navegador ou o webhook dizem. O backend consulta o pagamento na API do
 * Mercado Pago com o token da loja e o banco (pix_charge_apply_backend) só aprova com valor e referência iguais.
 *
 * Escrito a partir da documentação oficial (POST/GET /v1/payments, payment_method_id "pix"); conferir no
 * sandbox com uma conta de teste antes de ligar em produção (docs/operacao/pix-automatico.md).
 */
import { resolveMercadoPagoBaseUrl } from "./mercadopago";
import { getEncryptionKey } from "./secretBox";
import { isAdminConfigured } from "./supabase/admin";

export const PIX_CHARGE_TTL_MINUTES = 30;
export const PIX_SYNC_MIN_INTERVAL_SECONDS = 10;
const REQUEST_TIMEOUT_MS = 8_000;

export type PixAutoConfig = { encryptionKey: Buffer; payerEmail: string; webhookUrl: string | null };

type Env = Record<string, string | undefined>;

/** null = recurso indisponível neste ambiente (o checkout segue pela chave Pix estática, como hoje). */
export function getPixAutoConfig(
  env: Env = process.env,
  encryptionKey: Buffer | null = getEncryptionKey(),
  adminConfigured: boolean = isAdminConfigured()
): PixAutoConfig | null {
  if (env.PIX_AUTO_ENABLED !== "true") return null;
  if (!encryptionKey) return null;
  const payerEmail = (env.PIX_PAYER_EMAIL ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail) || payerEmail.length > 120) return null;
  if (!adminConfigured) return null;
  return { encryptionKey, payerEmail, webhookUrl: parseWebhookUrl(env.PIX_WEBHOOK_URL) };
}

/** Webhook opcional: só https público (sem usuário/senha). Sem ele, a confirmação vem da consulta da página. */
export function parseWebhookUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Formato do Access Token do Mercado Pago (produção APP_USR-..., teste TEST-...). Nunca é registrado em log. */
export function isPlausibleMercadoPagoToken(token: string): boolean {
  return /^(APP_USR|TEST)-[A-Za-z0-9_-]{20,300}$/.test(token);
}

/** 4 últimos caracteres, para o painel mostrar qual token está salvo sem revelá-lo. */
export function tokenHint(token: string): string {
  return token.slice(-4).replace(/[^A-Za-z0-9_-]/g, "x");
}

export type PixStatus = "pending" | "approved" | "cancelled" | "expired";

/** Status do Mercado Pago → status da cobrança. Desconhecido/intermediário fica pendente (nunca aprova à toa). */
export function mapMercadoPagoStatus(status: unknown, statusDetail?: unknown): PixStatus {
  switch (status) {
    case "approved":
      return "approved";
    case "cancelled":
      return statusDetail === "expired" ? "expired" : "cancelled";
    case "rejected":
    case "refunded":
    case "charged_back":
      return "cancelled";
    default:
      return "pending";
  }
}

export type MercadoPagoPixPayment = {
  id: string;
  status: PixStatus;
  amount: number | null;
  externalReference: string | null;
  qrCode: string | null;
  expiresAt: string | null;
  /** Moeda (o banco só aprova BRL). */
  currency: string | null;
  /** Conta que RECEBE o pagamento (o banco só aprova se for a conta da loja). */
  collectorId: string | null;
};

/** Lê só os campos de que dependemos; resposta fora do formato = null (nada é gravado). */
export function parseMercadoPagoPayment(body: unknown): MercadoPagoPixPayment | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const id = typeof b.id === "number" || typeof b.id === "string" ? String(b.id) : "";
  if (!/^[0-9]{1,30}$/.test(id)) return null;
  if (b.payment_method_id !== undefined && b.payment_method_id !== "pix") return null;
  const amountRaw = typeof b.transaction_amount === "number" ? b.transaction_amount : Number(b.transaction_amount);
  const poi = b.point_of_interaction as { transaction_data?: { qr_code?: unknown } } | undefined;
  const qr = poi?.transaction_data?.qr_code;
  return {
    id,
    status: mapMercadoPagoStatus(b.status, b.status_detail),
    amount: Number.isFinite(amountRaw) ? Math.round(amountRaw * 100) / 100 : null,
    externalReference: typeof b.external_reference === "string" ? b.external_reference : null,
    qrCode: typeof qr === "string" && qr.length >= 20 && qr.length <= 1000 ? qr : null,
    expiresAt: typeof b.date_of_expiration === "string" ? b.date_of_expiration : null,
    currency: typeof b.currency_id === "string" ? b.currency_id : null,
    collectorId: idString(b.collector_id ?? (b.collector as { id?: unknown } | undefined)?.id),
  };
}

/** Data de expiração no formato que o Mercado Pago aceita (ISO 8601 com milissegundos e fuso). */
export function pixExpiration(now: Date, minutes = PIX_CHARGE_TTL_MINUTES): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

function idString(value: unknown): string | null {
  const id = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  return /^[0-9]{1,20}$/.test(id) ? id : null;
}

export type PixApiFailure = { ok: false; reason: "request_failed" | "invalid_response"; httpStatus?: number };
export type PixApiResult = { ok: true; payment: MercadoPagoPixPayment } | PixApiFailure;

/**
 * Falha DEFINITIVA (o Mercado Pago recusou o pedido: credencial inválida, dados recusados) x INDEFINIDA (rede,
 * tempo esgotado, 5xx, 429, resposta ilegível: a cobrança pode ter sido criada). Só a definitiva libera a chave
 * Pix comum; a indefinida é tentada de novo com a mesma chave de idempotência.
 */
export function isDefinitiveFailure(failure: PixApiFailure): boolean {
  const status = failure.httpStatus;
  return failure.reason === "request_failed" && status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429;
}

async function mpFetch(token: string, path: string, init: RequestInit): Promise<{ ok: true; body: unknown } | PixApiFailure> {
  let response: Response;
  try {
    response = await fetch(
      `${resolveMercadoPagoBaseUrl({ MERCADOPAGO_BASE_URL: process.env.MERCADOPAGO_BASE_URL, NODE_ENV: process.env.NODE_ENV })}${path}`,
      {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}`, ...init.headers },
      }
    );
  } catch {
    return { ok: false, reason: "request_failed" };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "invalid_response", httpStatus: response.status };
  }
  if (!response.ok) return { ok: false, reason: "request_failed", httpStatus: response.status };
  return { ok: true, body };
}

async function mpCall(token: string, path: string, init: RequestInit): Promise<PixApiResult> {
  const r = await mpFetch(token, path, init);
  if (!r.ok) return r;
  const payment = parseMercadoPagoPayment(r.body);
  return payment ? { ok: true, payment } : { ok: false, reason: "invalid_response" };
}

/** Conta dona do token (GET /users/me): confere que o token funciona e dá o id da conta recebedora. */
export async function getMercadoPagoAccountId(token: string): Promise<{ ok: true; collectorId: string } | PixApiFailure> {
  const r = await mpFetch(token, "/users/me", { method: "GET" });
  if (!r.ok) return r;
  const id = idString((r.body as { id?: unknown } | null)?.id);
  return id ? { ok: true, collectorId: id } : { ok: false, reason: "invalid_response" };
}

/** Segredo de webhooks da aplicação (painel do Mercado Pago > Webhooks): texto curto, sem espaços. */
export function isPlausibleWebhookSecret(secret: string): boolean {
  return /^[A-Za-z0-9_-]{16,200}$/.test(secret);
}

/** Cria a cobrança Pix. A chave de idempotência é o id público do pedido: repetir nunca cria duas cobranças. */
export function createMercadoPagoPixPayment(
  token: string,
  params: { amount: number; description: string; orderPublicId: string; payerEmail: string; expiresAt: string; notificationUrl: string | null }
): Promise<PixApiResult> {
  return mpCall(token, "/v1/payments", {
    method: "POST",
    headers: { "X-Idempotency-Key": `menunext-pix-${params.orderPublicId}` },
    body: JSON.stringify({
      transaction_amount: params.amount,
      description: params.description.slice(0, 120),
      payment_method_id: "pix",
      payer: { email: params.payerEmail },
      external_reference: params.orderPublicId,
      date_of_expiration: params.expiresAt,
      ...(params.notificationUrl ? { notification_url: params.notificationUrl } : {}),
    }),
  });
}

export function getMercadoPagoPixPayment(token: string, paymentId: string): Promise<PixApiResult> {
  if (!/^[0-9]{1,30}$/.test(paymentId)) return Promise.resolve({ ok: false, reason: "invalid_response" });
  return mpCall(token, `/v1/payments/${paymentId}`, { method: "GET" });
}

/** Id do pagamento num aviso do Mercado Pago (corpo `{type:"payment", data:{id}}` ou query `?data.id=`/`?id=`). */
export function extractWebhookPaymentId(body: unknown, searchParams: URLSearchParams): string | null {
  const fromQuery = searchParams.get("data.id") ?? searchParams.get("id");
  let candidate: unknown = fromQuery;
  if (!candidate && body && typeof body === "object") {
    const b = body as { type?: unknown; topic?: unknown; data?: { id?: unknown } };
    const type = b.type ?? b.topic;
    if (type !== undefined && type !== "payment") return null;
    candidate = b.data?.id;
  }
  const id = typeof candidate === "number" ? String(candidate) : typeof candidate === "string" ? candidate.trim() : "";
  return /^[0-9]{1,30}$/.test(id) ? id : null;
}
