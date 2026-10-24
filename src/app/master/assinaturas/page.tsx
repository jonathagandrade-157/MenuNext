import { getAllPlans, requireMasterPage } from "@/lib/tenant";
import { getRequestOrigin } from "@/lib/site-url";
import { isBillingConfiguredFor, type SubscriptionProvider } from "@/lib/billingConfig";
import { PlansManager } from "@/components/master/PlansManager";
import { BillingSettingsForm } from "@/components/master/BillingSettingsForm";
import { BillingProviderCard } from "@/components/master/BillingProviderCard";
import { StatCard } from "@/components/master/StatCard";
import { getMasterMetrics } from "@/lib/masterMetrics";
import { formatCurrencyBRL } from "@/lib/products";

// Assinaturas SaaS (decisão tomada com o usuário): planos cadastrados aqui
// pelo MASTER (nome/preço reais, nunca inventados pelo código) — ver
// migration add_subscription_billing.sql. Listagem de assinaturas ATIVAS
// por restaurante é vista em /master/restaurantes (lista e detalhe, via as
// RPCs master_list_restaurants/master_get_restaurant).
export default async function AssinaturasPage() {
  const { supabase } = await requireMasterPage();

  const [plans, metrics] = await Promise.all([getAllPlans(supabase), getMasterMetrics(supabase, 30)]);
  const subscribersByPlan = Object.fromEntries(metrics.plans.map((p) => [p.plan_id, p.subscribers]));
  const activePlans = plans.filter((p) => p.is_active).length;

  // Provedor ativo das novas assinaturas (padrão asaas se a leitura falhar) e se cada um tem credenciais.
  const { data: providerData } = await supabase.rpc("billing_subscription_provider");
  const provider: SubscriptionProvider = providerData === "mercadopago" ? "mercadopago" : "asaas";
  const origin = await getRequestOrigin();

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <div>
        <h1 className="text-headline-lg text-graphite">Assinaturas</h1>
        <p className="mt-0.5 text-body-md text-text-muted">
          Planos disponíveis para os lojistas e provedor de cobrança (Asaas ou Mercado Pago).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard
          label="Receita recorrente (MRR)"
          value={formatCurrencyBRL(metrics.mrr)}
          hint="Soma das assinaturas em dia"
        />
        <StatCard
          label="Assinantes em dia"
          value={metrics.subscribers_active.toLocaleString("pt-BR")}
          hint="Lojas com assinatura ativa"
        />
        <StatCard
          label="Planos ativos"
          value={activePlans.toLocaleString("pt-BR")}
          hint={`${plans.length.toLocaleString("pt-BR")} cadastrado${plans.length === 1 ? "" : "s"} no total`}
        />
      </div>

      <PlansManager initialPlans={plans} subscribersByPlan={subscribersByPlan} />
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
