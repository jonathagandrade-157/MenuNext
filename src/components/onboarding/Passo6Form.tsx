"use client";

import { useActionState, useState } from "react";
import { savePasso6Action, skipOnboardingStepAction } from "@/lib/actions/onboarding";
import { initialStepState } from "@/lib/form-state";
import { FieldLabel, inputClass, ErrorMessage, StepNavigation } from "@/components/onboarding/OnboardingShell";
import type { Restaurant } from "@/lib/tenant";

const skipStep6 = skipOnboardingStepAction.bind(null, 6);

export function Passo6Form({ restaurant }: { restaurant: Restaurant }) {
  const [state, formAction] = useActionState(savePasso6Action, initialStepState);
  const [pixEnabled, setPixEnabled] = useState(restaurant.payment_pix);

  return (
    <form action={formAction} className="space-y-4">
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
        <input
          type="checkbox"
          name="payment_pix"
          checked={pixEnabled}
          onChange={(e) => setPixEnabled(e.target.checked)}
          className="mt-0.5 h-5 w-5 accent-primary"
        />
        <span className="flex-1">
          <span className="block text-sm font-semibold text-graphite">Pix</span>
          <span className="block text-sm text-text-muted">O cliente paga direto na sua chave Pix.</span>
          {pixEnabled && (
            <div className="mt-3">
              <FieldLabel>Chave Pix do restaurante *</FieldLabel>
              <input
                name="payment_pix_key"
                type="text"
                defaultValue={restaurant.payment_pix_key ?? ""}
                placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória"
                className={inputClass}
              />
            </div>
          )}
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
        <input
          type="checkbox"
          name="payment_cash"
          defaultChecked={restaurant.payment_cash}
          className="mt-0.5 h-5 w-5 accent-primary"
        />
        <span className="block text-sm font-semibold text-graphite">Dinheiro</span>
      </label>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
        <input
          type="checkbox"
          name="payment_card"
          defaultChecked={restaurant.payment_card}
          className="mt-0.5 h-5 w-5 accent-primary"
        />
        <span className="block text-sm font-semibold text-graphite">Maquininha / cartão na entrega ou retirada</span>
      </label>

      <ErrorMessage message={state.status === "error" ? state.message : undefined} />

      <StepNavigation backHref="/onboarding/passo-5" skipAction={skipStep6} submitLabel="Salvar e continuar" />
    </form>
  );
}
