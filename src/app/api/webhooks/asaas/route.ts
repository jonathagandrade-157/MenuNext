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

const STATUS_BY_EVENT: Record<string, "active" | "overdue" | "cancelled"> = {
  PAYMENT_CONFIRMED: "active",
  PAYMENT_RECEIVED: "active",
  PAYMENT_OVERDUE: "overdue",
  PAYMENT_DELETED: "cancelled",
  PAYMENT_REFUNDED: "cancelled",
};

export async function POST(request: Request) {
  const token = request.headers.get("asaas-access-token");
  if (!token) {
    return NextResponse.json({ error: "missing_token" }, { status: 401 });
  }

  let body: { event?: string; payment?: { id?: string; subscription?: string; nextDueDate?: string } };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const eventType = body.event;
  const subscriptionId = body.payment?.subscription;
  const paymentId = body.payment?.id;

  // Evento que não mexe no status da assinatura (ex.: PAYMENT_CREATED) —
  // reconhecido mas ignorado, sempre 200 para o Asaas não reenviar.
  const newStatus = eventType ? STATUS_BY_EVENT[eventType] : undefined;
  if (!newStatus || !subscriptionId || !paymentId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("process_asaas_webhook", {
    p_webhook_token: token,
    p_asaas_event_id: `${eventType}:${paymentId}`,
    p_event_type: eventType,
    p_asaas_subscription_id: subscriptionId,
    p_new_status: newStatus,
    p_current_period_end: body.payment?.nextDueDate ? new Date(body.payment.nextDueDate).toISOString() : null,
  });

  if (error) {
    const isAuthError = error.message.toLowerCase().includes("not_authorized");
    return NextResponse.json({ error: error.message }, { status: isAuthError ? 401 : 500 });
  }

  return NextResponse.json({ ok: true });
}
