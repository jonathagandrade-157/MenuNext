"use client";

import { useActionState } from "react";
import { savePasso3Action, skipOnboardingStepAction } from "@/lib/actions/onboarding";
import { initialStepState } from "@/lib/form-state";
import { Bike, Store } from "lucide-react";
import { ChoiceCard, ErrorMessage, StepNavigation } from "@/components/onboarding/OnboardingShell";
import type { Restaurant } from "@/lib/tenant";

const skipStep3 = skipOnboardingStepAction.bind(null, 3);

export function Passo3Form({ restaurant }: { restaurant: Restaurant }) {
  const [state, formAction] = useActionState(savePasso3Action, initialStepState);

  return (
    <form action={formAction} className="space-y-4">
      <ChoiceCard
        icon={<Bike className="h-5 w-5" aria-hidden />}
        title="Delivery"
        description="Você entrega os pedidos no endereço do cliente."
        name="service_delivery"
        defaultChecked={restaurant.service_delivery}
      />

      <ChoiceCard
        icon={<Store className="h-5 w-5" aria-hidden />}
        title="Retirada no local"
        description="O cliente retira o pedido no balcão do restaurante."
        name="service_pickup"
        defaultChecked={restaurant.service_pickup}
      />

      <p className="text-body-sm text-text-muted">Marque uma ou as duas. Você pode mudar isso depois, no painel.</p>

      <ErrorMessage message={state.status === "error" ? state.message : undefined} />

      <StepNavigation backHref="/onboarding/passo-2" skipAction={skipStep3} submitLabel="Salvar e continuar" />
    </form>
  );
}
