/**
 * Webhook do Mercado Pago — eventos da ASSINATURA do lojista (nunca confundir
 * com o Pix do checkout dos clientes finais, que não usa webhook nenhum).
 * Chamada server-to-server pelo Mercado Pago, sem sessão de usuário: a
 * autorização é a ASSINATURA HMAC da notificação (x-signature), nunca
 * auth.uid().
 *
 * Toda a lógica (assinatura, releitura do recurso na API, aplicação no banco
 * pelo service_role) está em src/lib/mercadopagoWebhookHandler.ts, onde é testada.
 */
import { NextResponse } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getMercadoPagoAuthorizedPayment, getMercadoPagoPreapproval, isMercadoPagoConfigured } from "@/lib/mercadopago";
import { handleMercadoPagoWebhook } from "@/lib/mercadopagoWebhookHandler";

export async function POST(request: Request) {
  // Sem a chave de servidor do Supabase nada pode ser aplicado: falha fechado.
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const query = new URL(request.url).searchParams;
  const result = await handleMercadoPagoWebhook(
    {
      xSignature: request.headers.get("x-signature"),
      xRequestId: request.headers.get("x-request-id"),
      dataId: query.get("data.id"),
      topic: query.get("type") ?? query.get("topic"),
      readBody: () => request.json(),
    },
    {
      rpc: (fn, args) => createAdminClient().rpc(fn, args),
      getPreapproval: getMercadoPagoPreapproval,
      getAuthorizedPayment: getMercadoPagoAuthorizedPayment,
      secret: process.env.MERCADOPAGO_WEBHOOK_SECRET,
      apiConfigured: isMercadoPagoConfigured(),
    }
  );
  return NextResponse.json(result.body, { status: result.status });
}
