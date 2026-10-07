import { getAllPlans, requireMasterPage } from "@/lib/tenant";
import { PlansManager } from "@/components/master/PlansManager";
import { BillingSettingsForm } from "@/components/master/BillingSettingsForm";

// Assinaturas SaaS (decisão tomada com o usuário): planos cadastrados aqui
// pelo MASTER (nome/preço reais, nunca inventados pelo código) — ver
// migration add_subscription_billing.sql. Listagem de assinaturas ATIVAS
// por restaurante é vista em /master/restaurantes (lista e detalhe, via as
// RPCs master_list_restaurants/master_get_restaurant).
export default async function AssinaturasPage() {
  const { supabase } = await requireMasterPage();

  const plans = await getAllPlans(supabase);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-graphite">Assinaturas</h1>
        <p className="mt-0.5 text-sm font-medium text-text-muted">
          Planos disponíveis para os lojistas e integração de cobrança (Asaas).
        </p>
      </div>

      <PlansManager initialPlans={plans} />
      <BillingSettingsForm />
    </div>
  );
}
