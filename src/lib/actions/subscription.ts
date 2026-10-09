"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isBillingConfigured } from "@/lib/billingConfig";
import { getMyRestaurant } from "@/lib/tenant";
import {
  createAsaasCustomer,
  createAsaasSubscription,
  deleteAsaasSubscription,
  getAsaasSubscription,
  listAsaasSubscriptionsByExternalReference,
} from "@/lib/asaas";
import { runSubscribeFlow, type SubscribeToPlanResult } from "@/lib/subscribeFlow";

const PLANO_PATH = "/painel/plano";

/**
 * Fluxo de assinatura do lojista — diferente de todo o resto do app, esta
 * Server Action faz chamadas de rede de verdade (Asaas), por isso nunca finge
 * sucesso: sem a configuração de cobrança, retorna erro explícito antes de criar
 * qualquer coisa. A lógica (abrir no banco, criar/reencontrar no Asaas, provar a
 * origem, registrar pelo backend) está em src/lib/subscribeFlow.ts.
 *
 * Nenhum passo libera acesso pago: a assinatura fica "pending" e o acesso só é
 * liberado quando o pagamento é confirmado (webhook verificado na API ou
 * reconciliação). O lojista nunca envia ids ao banco.
 */
export async function subscribeToPlanAction(planId: string): Promise<SubscribeToPlanResult> {
  if (!isBillingConfigured()) {
    return { status: "error", message: "A cobrança de assinaturas ainda não foi configurada. Tente novamente mais tarde." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const result = await runSubscribeFlow(planId, {
    beginSubscription: (id) => supabase.rpc("billing_begin_subscription", { p_plan_id: id }),
    getBillingProfile: async () => {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("name, document")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error || !profile?.document || !user.email) return null;
      return { name: profile.name || restaurant.name, document: profile.document, email: user.email };
    },
    attachSubscription: (args) =>
      createAdminClient().rpc("billing_attach_provider_subscription", {
        p_subscription_id: args.subscriptionId,
        p_provider_customer_id: args.customerId,
        p_provider_subscription_id: args.providerSubscriptionId,
        p_verified_amount: args.verifiedAmount,
      }),
    asaas: {
      listByExternalReference: listAsaasSubscriptionsByExternalReference,
      createCustomer: createAsaasCustomer,
      createSubscription: createAsaasSubscription,
      deleteSubscription: deleteAsaasSubscription,
      getSubscription: getAsaasSubscription,
    },
  });

  if (result.status === "success") {
    revalidatePath(PLANO_PATH);
    revalidatePath("/painel");
  }
  return result;
}
