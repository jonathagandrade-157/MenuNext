"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isMercadoPagoBillingConfigured } from "@/lib/billingConfig";
import { getMercadoPagoPreapproval } from "@/lib/mercadopago";
import { resolvePendingPaymentLink, type PendingPaymentLinkResult, type PendingSubscriptionRow } from "@/lib/pendingPaymentLink";

/**
 * Reabre o link de pagamento da assinatura pendente do lojista (OWNER). O banco
 * só devolve a assinatura pendente do próprio restaurante (RPC
 * billing_pending_subscription); o link é lido agora na API do provedor, depois
 * de conferir a assinatura (ver src/lib/pendingPaymentLink.ts).
 */
export async function getPendingPaymentLinkAction(): Promise<PendingPaymentLinkResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/cadastro");

  const { data, error } = await supabase.rpc("billing_pending_subscription");
  if (error) return { status: "error", message: "Não foi possível abrir o pagamento agora. Tente novamente em instantes." };
  const row = (Array.isArray(data) ? data[0] : data) as PendingSubscriptionRow | null | undefined;

  if (row?.out_provider === "mercadopago" && !isMercadoPagoBillingConfigured()) {
    return { status: "error", message: "A cobrança de assinaturas ainda não foi configurada. Tente novamente mais tarde." };
  }
  return resolvePendingPaymentLink(row, { getPreapproval: getMercadoPagoPreapproval });
}
