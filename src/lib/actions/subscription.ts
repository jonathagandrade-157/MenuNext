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
import { verifyAsaasSubscription } from "@/lib/billingVerify";

export type SubscribeToPlanResult = { status: "success" } | { status: "error"; message: string };

const PLANO_PATH = "/painel/plano";

const ALREADY_SUBSCRIBED_MESSAGE =
  "Seu restaurante já tem uma assinatura. Se há pagamento pendente ou atrasado, finalize-o pelo link que o Asaas enviou ao seu e-mail.";
const GENERIC_START_ERROR = "Não foi possível iniciar sua assinatura. Tente novamente em instantes.";

type BegunSubscription = {
  out_subscription_id: string;
  out_amount: number | string;
  out_plan_name: string;
};

/**
 * Fluxo de assinatura do lojista — diferente de todo o resto do app, esta
 * Server Action faz chamadas de rede de verdade (Asaas), por isso nunca finge
 * sucesso: sem a configuração de cobrança, retorna erro explícito.
 *
 * Passos: 1) o BANCO abre a assinatura (billing_begin_subscription, sessão do
 * lojista) e define restaurante, plano, valor e moeda; 2) o servidor reencontra
 * ou cria a assinatura no Asaas com a referência do MenuNext; 3) o servidor LÊ
 * a assinatura de volta pela API autenticada e confere cliente, valor, status e
 * referência (prova de origem); 4) só então o BACKEND (service_role) registra os
 * ids (billing_attach_provider_subscription). O lojista nunca envia ids ao banco.
 *
 * Nenhum desses passos libera acesso pago: a assinatura fica "pending" e o
 * acesso só é liberado quando o pagamento é confirmado (webhook verificado ou
 * reconciliação com a API).
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

  // Abre (ou retoma) a assinatura no banco, antes de qualquer chamada ao
  // Asaas: assinatura viva não pode ser duplicada e o valor vem do plano.
  const { data: begun, error: beginError } = await supabase.rpc("billing_begin_subscription", { p_plan_id: planId });
  if (beginError) {
    if (beginError.message.includes("already_subscribed")) {
      return { status: "error", message: ALREADY_SUBSCRIBED_MESSAGE };
    }
    if (beginError.message.includes("plan_not_found") || beginError.message.includes("plan_not_billable")) {
      return { status: "error", message: "Plano não encontrado." };
    }
    if (beginError.message.includes("not_authorized")) {
      return { status: "error", message: "Só o responsável pela loja pode assinar um plano." };
    }
    return { status: "error", message: GENERIC_START_ERROR };
  }
  const attempt = (Array.isArray(begun) ? begun[0] : begun) as BegunSubscription | undefined;
  if (!attempt?.out_subscription_id) return { status: "error", message: GENERIC_START_ERROR };

  const internalId = attempt.out_subscription_id;
  const amount = Number(attempt.out_amount);

  // 2) Reencontra uma assinatura anterior desta MESMA tentativa (evita cobrança
  //    em dobro se um clique anterior morreu no meio) ou cria uma nova.
  let customerId: string | null = null;
  let providerSubscriptionId: string | null = null;
  let createdNow = false;

  const existing = await listAsaasSubscriptionsByExternalReference(internalId);
  if (!existing.ok) return { status: "error", message: GENERIC_START_ERROR };

  for (const candidate of existing.data.data ?? []) {
    if (candidate.deleted || candidate.status !== "ACTIVE") continue;
    const checked = verifyAsaasSubscription(candidate, {
      subscriptionId: candidate.id,
      customerId: candidate.customer,
      amount,
      externalReference: internalId,
    });
    if (checked.ok) {
      customerId = candidate.customer;
      providerSubscriptionId = candidate.id;
      break;
    }
    // Sobra de uma tentativa com outro valor (o plano mudou de preço): remove.
    await deleteAsaasSubscription(candidate.id);
  }

  if (!providerSubscriptionId || !customerId) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("name, document")
      .eq("user_id", user.id)
      .maybeSingle();
    if (profileError || !profile?.document || !user.email) {
      return { status: "error", message: "Não foi possível identificar seus dados de cobrança. Complete seu cadastro e tente novamente." };
    }

    const customerResult = await createAsaasCustomer({
      name: profile.name || restaurant.name,
      email: user.email,
      cpfCnpj: profile.document,
    });
    if (!customerResult.ok) {
      return { status: "error", message: "Não foi possível criar seu cadastro de cobrança. Tente novamente em instantes." };
    }

    const subscriptionResult = await createAsaasSubscription({
      customerId: customerResult.data.id,
      value: amount,
      description: `MenuNext — plano ${attempt.out_plan_name}`,
      externalReference: internalId,
    });
    if (!subscriptionResult.ok) {
      return { status: "error", message: "Não foi possível criar sua assinatura. Tente novamente em instantes." };
    }
    customerId = customerResult.data.id;
    providerSubscriptionId = subscriptionResult.data.id;
    createdNow = true;
  }

  // Desfaz no Asaas o que ESTA chamada criou quando não dá para registrar.
  const rollbackRemote = async () => {
    if (createdNow && providerSubscriptionId) await deleteAsaasSubscription(providerSubscriptionId);
  };

  // 3) Prova de origem: lê de volta pela API autenticada e confere tudo.
  const remote = await getAsaasSubscription(providerSubscriptionId);
  const verdict = remote.ok
    ? verifyAsaasSubscription(remote.data, {
        subscriptionId: providerSubscriptionId,
        customerId,
        amount,
        externalReference: internalId,
      })
    : ({ ok: false, reason: "remote_unavailable" } as const);
  if (!verdict.ok) {
    await rollbackRemote();
    return { status: "error", message: "Não foi possível confirmar sua assinatura no Asaas. Tente novamente em instantes." };
  }

  // 4) O backend registra; o lojista nunca fala com esta RPC.
  const admin = createAdminClient();
  const { error: attachError } = await admin.rpc("billing_attach_provider_subscription", {
    p_subscription_id: internalId,
    p_provider_customer_id: customerId,
    p_provider_subscription_id: providerSubscriptionId,
    p_verified_amount: amount,
  });
  if (attachError) {
    await rollbackRemote();
    return { status: "error", message: "Não foi possível registrar sua assinatura. Tente novamente em instantes." };
  }

  revalidatePath(PLANO_PATH);
  revalidatePath("/painel");
  return { status: "success" };
}
