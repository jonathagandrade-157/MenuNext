import { getActivePlans, getMyAccessState, requireOwnerPage } from "@/lib/tenant";
import { isAsaasConfigured } from "@/lib/asaas";
import { PlanoClient } from "@/components/painel/plano/PlanoClient";

// Restrita ao OWNER (JON-10): billing é decisão de dono, fora do escopo
// operacional. Decisão tomada com o usuário: planos reais cadastrados pelo
// MASTER em /master/assinaturas, gateway Asaas, assinatura overdue/cancelled
// bloqueia painel + loja pública (ver middleware em painel/layout.tsx e
// checagem em loja/[slug]/page.tsx).
export default async function PlanoPage() {
  const { supabase, restaurant } = await requireOwnerPage();

  const [plans, accessState] = await Promise.all([getActivePlans(supabase), getMyAccessState(supabase)]);
  const currentPlan = restaurant.plan_id ? plans.find((p) => p.id === restaurant.plan_id) ?? null : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-graphite">Plano e assinatura</h1>
        <p className="mt-0.5 text-sm font-medium text-text-muted">Escolha o plano do MenuNext para o seu restaurante.</p>
      </div>

      <PlanoClient
        plans={plans}
        currentPlan={currentPlan}
        subscriptionStatus={restaurant.subscription_status}
        accessState={accessState}
        asaasConfigured={isAsaasConfigured()}
      />
    </div>
  );
}
