"use client";

import { useActionState } from "react";
import { savePasso3Action, skipOnboardingStepAction } from "@/lib/actions/onboarding";
import { initialStepState } from "@/lib/form-state";
import { ErrorMessage, StepNavigation } from "@/components/onboarding/OnboardingShell";
import type { Restaurant } from "@/lib/tenant";

const skipStep3 = skipOnboardingStepAction.bind(null, 3);

export function Passo3Form({ restaurant }: { restaurant: Restaurant }) {
  const [state, formAction] = useActionState(savePasso3Action, initialStepState);

  return (
    <form action={formAction} className="space-y-4">
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
        <input
          type="checkbox"
          name="service_delivery"
          defaultChecked={restaurant.service_delivery}
          className="mt-0.5 h-5 w-5 accent-primary"
        />
        <span>
          <span className="block text-sm font-semibold text-graphite">Delivery</span>
          <span className="block text-sm text-text-muted">Você entrega os pedidos no endereço do cliente.</span>
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
        <input
          type="checkbox"
          name="service_pickup"
          defaultChecked={restaurant.service_pickup}
          className="mt-0.5 h-5 w-5 accent-primary"
        />
        <span>
          <span className="block text-sm font-semibold text-graphite">Retirada no local</span>
          <span className="block text-sm text-text-muted">O cliente retira o pedido no balcão do restaurante.</span>
        </span>
      </label>

      <ErrorMessage message={state.status === "error" ? state.message : undefined} />

      <StepNavigation backHref="/onboarding/passo-2" skipAction={skipStep3} submitLabel="Salvar e continuar" />
    </form>
  );
}
