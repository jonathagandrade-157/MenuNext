import { getAllPlans, requireMasterPage } from "@/lib/tenant";
import { getRequestOrigin } from "@/lib/site-url";
import { isBillingConfiguredFor, type SubscriptionProvider } from "@/lib/billingConfig";
import { PlansManager } from "@/components/master/PlansManager";
import { BillingSettingsForm } from "@/components/master/BillingSettingsForm";
import { BillingProviderCard } from "@/components/master/BillingProviderCard";

// Assinaturas SaaS (decisão tomada com o usuário): planos cadastrados aqui
// pelo MASTER (nome/preço reais, nunca inventados pelo código) — ver
// migration add_subscription_billing.sql. Listagem de assinaturas ATIVAS
// por restaurante é vista em /master/restaurantes (lista e detalhe, via as
// RPCs master_list_restaurants/master_get_restaurant).
export default async function AssinaturasPage() {
  const { supabase } = await requireMasterPage();

  const plans = await getAllPlans(supabase);

  // Provedor ativo das novas assinaturas (padrão asaas se a leitura falhar) e se cada um tem credenciais.
  const { data: providerData } = await supabase.rpc("billing_subscription_provider");
  const provider: SubscriptionProvider = providerData === "mercadopago" ? "mercadopago" : "asaas";
  const origin = await getRequestOrigin();

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-graphite">Assinaturas</h1>
        <p className="mt-0.5 text-sm font-medium text-text-muted">
          Planos disponíveis para os lojistas e provedor de cobrança (Asaas ou Mercado Pago).
        </p>
      </div>

      <PlansManager initialPlans={plans} />
      <BillingProviderCard
        provider={provider}
        asaasReady={isBillingConfiguredFor("asaas")}
        mercadopagoReady={isBillingConfiguredFor("mercadopago")}
        mercadopagoWebhookUrl={`${origin}/api/webhooks/mercadopago`}
      />
      <BillingSettingsForm />
    </div>
  );
}
