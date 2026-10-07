/**
 * Webhook do Asaas — eventos de pagamento da ASSINATURA do lojista (nunca
 * confundir com o Pix do checkout dos clientes finais, que não usa
 * webhook nenhum). Chamada server-to-server pelo Asaas, sem sessão de
 * usuário — por isso a autorização é por token (header `asaas-access-token`,
 * configurado para ser o mesmo valor salvo em /master/assinaturas), nunca
 * por auth.uid(). A validação real e definitiva do token acontece dentro da
 * RPC process_asaas_webhook (SECURITY DEFINER, compara contra
 * billing_settings) — nunca confia só nesta rota.
 *
 * Sempre responde 200 (mesmo para evento desconhecido/ignorado) para o
 * Asaas não ficar reenviando — exceto quando o token está ausente/errado
 * (401) ou o payload é inválido (400), casos em que reenvio não ajudaria
 * de qualquer forma.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveSubscriptionStatusChange, type AsaasWebhookBody } from "@/lib/asaasWebhook";

export async function POST(request: Request) {
  const token = request.headers.get("asaas-access-token");
  if (!token) {
    return NextResponse.json({ error: "missing_token" }, { status: 401 });
  }

  let body: AsaasWebhookBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  // Evento que não mexe no status da assinatura (ex.: PAYMENT_CREATED, ou
  // cobrança avulsa sem assinatura) — reconhecido mas ignorado, sempre 200
  // para o Asaas não reenviar.
  const change = resolveSubscriptionStatusChange(body);
  if (!change) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("process_asaas_webhook", {
    p_webhook_token: token,
    p_asaas_event_id: change.eventId,
    p_event_type: body.event,
    p_asaas_subscription_id: change.subscriptionId,
    p_new_status: change.status,
  });

  if (error) {
    const isAuthError = error.message.toLowerCase().includes("not_authorized");
    return NextResponse.json({ error: error.message }, { status: isAuthError ? 401 : 500 });
  }

  return NextResponse.json({ ok: true });
}
