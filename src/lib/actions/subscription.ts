"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isBillingConfigured, isMercadoPagoBillingConfigured } from "@/lib/billingConfig";
import { getMyRestaurant } from "@/lib/tenant";
import { getRequestOrigin } from "@/lib/site-url";
import {
  createAsaasCustomer,
  createAsaasSubscription,
  deleteAsaasSubscription,
  getAsaasSubscription,
  listAsaasSubscriptionsByExternalReference,
} from "@/lib/asaas";
import {
  cancelMercadoPagoPreapproval,
  createMercadoPagoPreapproval,
  getMercadoPagoPreapproval,
  searchMercadoPagoPreapprovalsByExternalReference,
} from "@/lib/mercadopago";
import { runSubscribeFlow, type SubscribeToPlanResult } from "@/lib/subscribeFlow";
import { runMercadoPagoSubscribeFlow } from "@/lib/subscribeFlowMp";

const PLANO_PATH = "/painel/plano";

/**
 * Fluxo de assinatura do lojista — diferente de todo o resto do app, esta
 * Server Action faz chamadas de rede de verdade (Asaas ou Mercado Pago), por
 * isso nunca finge sucesso: sem a configuração de cobrança, retorna erro
 * explícito antes de criar qualquer coisa.
 *
 * QUEM ESCOLHE O PROVEDOR é o Master (configurado no banco), nunca o navegador:
 * billing_begin_subscription usa o provedor escolhido e devolve `out_provider`;
 * a ação só segue o fluxo desse provedor. A lógica de cada fluxo (abrir no
 * banco, criar/reencontrar no provedor, provar a origem, registrar pelo
 * backend) está em src/lib/subscribeFlow.ts (Asaas) e src/lib/subscribeFlowMp.ts
 * (Mercado Pago).
 *
 * Nenhum passo libera acesso pago: a assinatura fica "pending" e o acesso só é
 * liberado quando o pagamento é confirmado (webhook verificado na API ou
 * reconciliação). O lojista nunca envia ids ao banco.
 */
export async function subscribeToPlanAction(planId: string): Promise<SubscribeToPlanResult> {
  const notConfigured: SubscribeToPlanResult = {
    status: "error",
    message: "A cobrança de assinaturas ainda não foi configurada. Tente novamente mais tarde.",
  };
  // Sem nenhum provedor configurado, nada é aberto (nem a tentativa no banco).
  if (!isBillingConfigured() && !isMercadoPagoBillingConfigured()) return notConfigured;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  // O banco abre a assinatura com o provedor escolhido pelo Master e o devolve.
  const begun = await supabase.rpc("billing_begin_subscription", { p_plan_id: planId });
  const first = (Array.isArray(begun.data) ? begun.data[0] : begun.data) as { out_provider?: string } | null | undefined;
  const provider = first?.out_provider === "mercadopago" ? "mercadopago" : "asaas";
  const beginSubscription = () => Promise.resolve({ data: begun.data as unknown, error: begun.error });

  if (provider === "mercadopago" ? !isMercadoPagoBillingConfigured() : !isBillingConfigured()) return notConfigured;

  const attachSubscription = (args: {
    subscriptionId: string;
    customerId: string;
    providerSubscriptionId: string;
    verifiedAmount: number;
  }) =>
    createAdminClient().rpc("billing_attach_provider_subscription", {
      p_subscription_id: args.subscriptionId,
      p_provider_customer_id: args.customerId,
      p_provider_subscription_id: args.providerSubscriptionId,
      p_verified_amount: args.verifiedAmount,
    });

  let result: SubscribeToPlanResult;
  if (provider === "mercadopago") {
    result = await runMercadoPagoSubscribeFlow(planId, {
      beginSubscription,
      getPayerEmail: async () => user.email ?? null,
      attachSubscription,
      backUrl: `${await getRequestOrigin()}${PLANO_PATH}`,
      mp: {
        searchByExternalReference: searchMercadoPagoPreapprovalsByExternalReference,
        createPreapproval: createMercadoPagoPreapproval,
        getPreapproval: getMercadoPagoPreapproval,
        cancelPreapproval: cancelMercadoPagoPreapproval,
      },
    });
  } else {
    result = await runSubscribeFlow(planId, {
      beginSubscription,
      getBillingProfile: async () => {
        const { data: profile, error } = await supabase
          .from("profiles")
          .select("name, document")
          .eq("user_id", user.id)
          .maybeSingle();
        if (error || !profile?.document || !user.email) return null;
        return { name: profile.name || restaurant.name, document: profile.document, email: user.email };
      },
      attachSubscription,
      asaas: {
        listByExternalReference: listAsaasSubscriptionsByExternalReference,
        createCustomer: createAsaasCustomer,
        createSubscription: createAsaasSubscription,
        deleteSubscription: deleteAsaasSubscription,
        getSubscription: getAsaasSubscription,
      },
    });
  }

  if (result.status === "success") {
    revalidatePath(PLANO_PATH);
    revalidatePath("/painel");
  }
  return result;
}
