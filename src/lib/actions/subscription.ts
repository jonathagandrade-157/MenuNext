"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyRestaurant } from "@/lib/tenant";
import { createAsaasCustomer, createAsaasSubscription, isAsaasConfigured } from "@/lib/asaas";

export type SubscribeToPlanResult = { status: "success" } | { status: "error"; message: string };

const PLANO_PATH = "/painel/plano";

/**
 * Fluxo de assinatura do lojista — diferente de todo o resto do app, esta
 * Server Action faz uma chamada de rede de verdade (Asaas), por isso nunca
 * finge sucesso: se ASAAS_API_KEY não estiver configurada, retorna erro
 * explícito em vez de simular uma assinatura. Passos: 1) cria/recupera o
 * customer no Asaas usando nome+documento (profiles) + e-mail (auth.users,
 * já disponível na sessão); 2) cria a subscription recorrente; 3) só então
 * grava os IDs no banco via start_restaurant_subscription (RPC —
 * subscription_status/asaas_*_id são protegidos por REVOKE de coluna,
 * nunca graváveis por update direto).
 */
export async function subscribeToPlanAction(planId: string): Promise<SubscribeToPlanResult> {
  if (!isAsaasConfigured()) {
    return { status: "error", message: "A cobrança de assinaturas ainda não foi configurada. Tente novamente mais tarde." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("id, name, price")
    .eq("id", planId)
    .eq("is_active", true)
    .maybeSingle();
  if (planError || !plan) return { status: "error", message: "Plano não encontrado." };

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
    value: Number(plan.price),
    description: `MenuNext — plano ${plan.name}`,
  });
  if (!subscriptionResult.ok) {
    return { status: "error", message: "Não foi possível criar sua assinatura. Tente novamente em instantes." };
  }

  const { error: rpcError } = await supabase.rpc("start_restaurant_subscription", {
    p_plan_id: plan.id,
    p_asaas_customer_id: customerResult.data.id,
    p_asaas_subscription_id: subscriptionResult.data.id,
  });
  if (rpcError) {
    return { status: "error", message: "Assinatura criada, mas não foi possível registrá-la. Entre em contato com o suporte." };
  }

  revalidatePath(PLANO_PATH);
  revalidatePath("/painel");
  return { status: "success" };
}
