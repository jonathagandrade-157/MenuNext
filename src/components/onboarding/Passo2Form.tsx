"use client";

import { useActionState } from "react";
import { savePasso2Action, skipOnboardingStepAction } from "@/lib/actions/onboarding";
import { initialStepState } from "@/lib/form-state";
import { FieldLabel, inputClass, ErrorMessage, StepNavigation } from "@/components/onboarding/OnboardingShell";
import type { Restaurant } from "@/lib/tenant";

const skipStep2 = skipOnboardingStepAction.bind(null, 2);

export function Passo2Form({ restaurant }: { restaurant: Restaurant }) {
  const [state, formAction] = useActionState(savePasso2Action, initialStepState);

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel>CEP *</FieldLabel>
          <input name="zip" defaultValue={restaurant.address_zip ?? ""} required className={inputClass} />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <FieldLabel>Estado *</FieldLabel>
          <input
            name="state"
            defaultValue={restaurant.address_state ?? ""}
            required
            maxLength={2}
            placeholder="SP"
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <FieldLabel>Endereço *</FieldLabel>
        <input name="street" defaultValue={restaurant.address_street ?? ""} required className={inputClass} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel>Número</FieldLabel>
          <input name="number" defaultValue={restaurant.address_number ?? ""} className={inputClass} />
        </div>
        <div>
          <FieldLabel>Complemento</FieldLabel>
          <input name="complement" defaultValue={restaurant.address_complement ?? ""} className={inputClass} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel>Bairro</FieldLabel>
          <input name="neighborhood" defaultValue={restaurant.address_neighborhood ?? ""} className={inputClass} />
        </div>
        <div>
          <FieldLabel>Cidade *</FieldLabel>
          <input name="city" defaultValue={restaurant.address_city ?? ""} required className={inputClass} />
        </div>
      </div>

      <ErrorMessage message={state.status === "error" ? state.message : undefined} />

      <StepNavigation backHref="/onboarding/passo-1" skipAction={skipStep2} submitLabel="Salvar e continuar" />
    </form>
  );
}
