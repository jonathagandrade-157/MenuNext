/**
 * Aviso do Mercado Pago sobre um pagamento Pix de cliente (Pix automático das lojas). O corpo NÃO é prova de
 * nada: só traz o id do pagamento, que dispara uma consulta à API do Mercado Pago com o token da loja dona da
 * cobrança (syncPixCharge). Id que não é de nenhuma cobrança nossa é ignorado. Sempre responde rápido; 2xx para
 * o Mercado Pago não reenviar à toa.
 */
import { extractWebhookPaymentId } from "./pixAuto";

export const PIX_WEBHOOK_MAX_BODY = 8_192;

export type PixWebhookDeps = {
  enabled: boolean;
  rateLimited: () => Promise<boolean>;
  sync: (providerPaymentId: string) => Promise<{ status: string }>;
};

export async function handlePixWebhook(
  input: { rawBody: string; searchParams: URLSearchParams },
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
  const result = await deps.sync(id);
  return { status: 200, body: { result: result.status === "failed" ? "retry_later" : "ok" } };
}
