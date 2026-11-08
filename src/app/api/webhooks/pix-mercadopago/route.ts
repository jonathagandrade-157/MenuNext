/**
 * Webhook do Pix automático das lojas (Mercado Pago da PRÓPRIA loja). Desligado = 404.
 * Toda a regra está em src/lib/pixWebhookHandler.ts (testada): o corpo só dispara uma consulta à API do
 * Mercado Pago; quem decide se está pago é o banco, com o valor e a referência lidos lá.
 */
import { NextResponse } from "next/server";
import { getPixAutoConfig } from "@/lib/pixAuto";
import { syncPixCharge } from "@/lib/pixAutoService";
import { handlePixWebhook, PIX_WEBHOOK_MAX_BODY } from "@/lib/pixWebhookHandler";
import { checkIpRateLimit } from "@/lib/rateLimit";

export async function POST(request: Request) {
  const enabled = getPixAutoConfig() !== null;
  const rawBody = enabled ? (await request.text()).slice(0, PIX_WEBHOOK_MAX_BODY + 1) : "";
  const result = await handlePixWebhook(
    {
      rawBody,
      searchParams: new URL(request.url).searchParams,
      xSignature: request.headers.get("x-signature"),
      xRequestId: request.headers.get("x-request-id"),
    },
    {
      enabled,
      rateLimited: async () => !(await checkIpRateLimit("pix-webhook:ip", { limit: 120, windowSeconds: 60 })).allowed,
      sync: (id, signature) => syncPixCharge({ providerPaymentId: id, signature }, 2),
    }
  );
  return NextResponse.json(result.body, { status: result.status });
}
