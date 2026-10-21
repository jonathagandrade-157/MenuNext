/**
 * Autenticação e leitura do webhook do Mercado Pago.
 *
 * O Mercado Pago não usa token fixo: assina cada notificação com HMAC-SHA256
 * (cabeçalho `x-signature` = "ts=<ms>,v1=<hex>") sobre o manifesto
 *   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 * onde `data.id` vem da QUERY da URL (nunca do corpo) e vai em minúsculas.
 * O segredo vem de `MERCADOPAGO_WEBHOOK_SECRET` (tela de Webhooks do app no
 * Mercado Pago), que precisa ser o valor em claro — por isso não fica no banco
 * em forma de hash como o token do Asaas.
 *
 * A assinatura NÃO cobre o corpo. Por isso o id do recurso usado daqui para
 * frente é sempre o da query (assinado), e o efeito sobre a assinatura do
 * lojista só vale depois de reler o recurso pela API autenticada.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function buildMercadoPagoManifest(input: { dataId: string | null; requestId: string | null; ts: string }): string {
  let manifest = "";
  if (input.dataId) manifest += `id:${input.dataId.toLowerCase()};`;
  if (input.requestId) manifest += `request-id:${input.requestId};`;
  manifest += `ts:${input.ts};`;
  return manifest;
}

export function computeMercadoPagoSignature(secret: string, manifest: string): string {
  return createHmac("sha256", secret).update(manifest, "utf8").digest("hex");
}

function parseSignatureHeader(header: string): { ts: string; v1: string } | null {
  let ts: string | null = null;
  let v1: string | null = null;
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "ts") ts = value;
    else if (key === "v1") v1 = value.toLowerCase();
  }
  if (!ts || !v1 || !/^\d{1,20}$/.test(ts) || !/^[0-9a-f]{64}$/.test(v1)) return null;
  return { ts, v1 };
}

/** Confere a assinatura em tempo constante. Sem segredo ou cabeçalho válido: false (falha fechado). */
export function verifyMercadoPagoSignature(input: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string | undefined;
}): boolean {
  if (!input.secret || !input.xSignature) return false;
  const parsed = parseSignatureHeader(input.xSignature);
  if (!parsed) return false;
  const expected = computeMercadoPagoSignature(
    input.secret,
    buildMercadoPagoManifest({ dataId: input.dataId, requestId: input.xRequestId, ts: parsed.ts })
  );
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parsed.v1, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type MercadoPagoWebhookBody = {
  id?: unknown;
  type?: unknown;
  topic?: unknown;
  action?: unknown;
  data?: { id?: unknown } | null;
};

export type MercadoPagoEventKind = "preapproval" | "authorized_payment";

export type MercadoPagoEvent = {
  kind: MercadoPagoEventKind;
  /** Identificador do evento (idempotência); cai para uma chave composta se o corpo não trouxer `id`. */
  eventId: string;
  /** Id do recurso a reler na API — vem da query assinada. */
  resourceId: string;
  action: string | null;
};

function str(value: unknown, max = 200): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

const KIND_BY_TOPIC: Record<string, MercadoPagoEventKind> = {
  subscription_preapproval: "preapproval",
  subscription_authorized_payment: "authorized_payment",
};

/**
 * Extrai o evento. `dataId` e `topic` são os da query da URL (assinados e
 * recebidos do próprio Mercado Pago). Devolve null para o que não interessa
 * (outros tópicos, pagamentos avulsos) ou quando o corpo contradiz a query.
 */
export function parseMercadoPagoWebhook(
  body: MercadoPagoWebhookBody | null | undefined,
  query: { dataId: string | null; topic: string | null }
): MercadoPagoEvent | null {
  if (!body || typeof body !== "object") return null;
  const resourceId = str(query.dataId);
  if (!resourceId) return null;

  const topic = str(query.topic) ?? str(body.type) ?? str(body.topic);
  const kind = topic ? KIND_BY_TOPIC[topic] : undefined;
  if (!kind) return null;

  const bodyDataId = str(body.data?.id);
  if (bodyDataId && bodyDataId.toLowerCase() !== resourceId.toLowerCase()) return null;

  const action = str(body.action, 100);
  const eventId = str(body.id) ?? `${kind}:${resourceId}:${action ?? "event"}`;
  return { kind, eventId: `mp:${eventId}`, resourceId, action };
}
