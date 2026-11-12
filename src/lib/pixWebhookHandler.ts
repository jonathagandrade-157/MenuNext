/**
 * Aviso do Mercado Pago sobre um pagamento Pix de cliente (Pix automático das lojas). O corpo NÃO é prova de
 * nada: só traz o id do pagamento, que dispara uma consulta à API do Mercado Pago com o token da loja dona da
 * cobrança (syncPixCharge). Se a loja cadastrou a assinatura secreta de webhooks da aplicação dela, o
 * x-signature é validado (HMAC-SHA256 de `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, documentação do
 * Mercado Pago) e aviso sem assinatura válida recebe 401 sem consultar nada. Id que não é de nenhuma cobrança
 * nossa é ignorado. 2xx para o Mercado Pago não reenviar à toa.
 */
import { extractWebhookPaymentId } from "./pixAuto";
import type { WebhookSignature } from "./pixAutoService";

export const PIX_WEBHOOK_MAX_BODY = 8_192;

export type PixWebhookDeps = {
  enabled: boolean;
  rateLimited: () => Promise<boolean>;
  sync: (providerPaymentId: string, signature: WebhookSignature) => Promise<{ status: string }>;
};

export async function handlePixWebhook(
  input: { rawBody: string; searchParams: URLSearchParams; xSignature: string | null; xRequestId: string | null },
  deps: PixWebhookDeps
): Promise<{ status: number; body: Record<string, string> }> {
  if (!deps.enabled) return { status: 404, body: { error: "not_found" } };
  if (await deps.rateLimited()) return { status: 429, body: { error: "rate_limited" } };
  if (input.rawBody.length > PIX_WEBHOOK_MAX_BODY) return { status: 413, body: { error: "too_large" } };
  let body: unknown = null;
  if (input.rawBody.trim()) {
    try {
      body = JSON.parse(input.rawBody);
    } catch {
      return { status: 400, body: { error: "invalid_body" } };
    }
  }
  const id = extractWebhookPaymentId(body, input.searchParams);
  if (!id) return { status: 200, body: { result: "ignored" } };
  const result = await deps.sync(id, { xSignature: input.xSignature, xRequestId: input.xRequestId, dataId: input.searchParams.get("data.id") });
  if (result.status === "unauthorized") return { status: 401, body: { error: "invalid_signature" } };
  // falha transitória: 500 faz o Mercado Pago reenviar mais tarde (a consulta é idempotente)
  if (result.status === "failed") return { status: 500, body: { result: "retry_later" } };
  return { status: 200, body: { result: "ok" } };
}
