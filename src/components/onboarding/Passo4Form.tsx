"use client";

import { useActionState } from "react";
import { savePasso4Action, skipOnboardingStepAction } from "@/lib/actions/onboarding";
import { initialStepState } from "@/lib/form-state";
import { FieldLabel, inputClass, ErrorMessage, StepNavigation } from "@/components/onboarding/OnboardingShell";
import type { Restaurant } from "@/lib/tenant";

const skipStep4 = skipOnboardingStepAction.bind(null, 4);

export function Passo4Form({ restaurant }: { restaurant: Restaurant }) {
  const [state, formAction] = useActionState(savePasso4Action, initialStepState);

  if (!restaurant.service_delivery) {
    return (
      <form action={formAction} className="space-y-5">
        <p className="rounded-lg bg-surface-subdued px-4 py-3 text-sm text-text-muted">
          Você configurou apenas retirada no local no passo anterior, então não é preciso definir taxa ou raio de
          entrega agora. Você pode ativar o delivery depois no painel.
        </p>
        <StepNavigation backHref="/onboarding/passo-3" skipAction={skipStep4} submitLabel="Continuar" />
      </form>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <FieldLabel>Taxa de entrega (R$) *</FieldLabel>
        <input
          name="delivery_fee"
          type="text"
          inputMode="decimal"
          defaultValue={restaurant.delivery_fee ?? ""}
          placeholder="8,00"
          required
          className={inputClass}
        />
      </div>

      <div>
        <FieldLabel>Raio de entrega (km) *</FieldLabel>
        <input
          name="delivery_radius_km"
          type="text"
          inputMode="decimal"
          defaultValue={restaurant.delivery_radius_km ?? ""}
          placeholder="5"
          required
          className={inputClass}
        />
      </div>

      <ErrorMessage message={state.status === "error" ? state.message : undefined} />

      <StepNavigation backHref="/onboarding/passo-3" skipAction={skipStep4} submitLabel="Salvar e continuar" />
    </form>
  );
}
