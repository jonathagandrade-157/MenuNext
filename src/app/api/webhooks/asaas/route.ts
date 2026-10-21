/**
 * Webhook do Asaas — eventos de pagamento da ASSINATURA do lojista (nunca
 * confundir com o Pix do checkout dos clientes finais, que não usa
 * webhook nenhum). Chamada server-to-server pelo Asaas, sem sessão de
 * usuário — por isso a autorização é por token (header `asaas-access-token`,
 * o mesmo valor salvo em /master/assinaturas), nunca por auth.uid().
 *
 * Toda a lógica (token, conferência do pagamento na API do Asaas, aplicação no
 * banco) está em src/lib/asaasWebhookHandler.ts, onde é testada.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAsaasPayment, isAsaasConfigured } from "@/lib/asaas";
import { handleAsaasWebhook } from "@/lib/asaasWebhookHandler";

export async function POST(request: Request) {
  const supabase = await createClient();
  const result = await handleAsaasWebhook(request.headers.get("asaas-access-token"), () => request.json(), {
    rpc: (fn, args) => supabase.rpc(fn, args),
    getPayment: getAsaasPayment,
    asaasConfigured: isAsaasConfigured(),
  });
  return NextResponse.json(result.body, { status: result.status });
}
