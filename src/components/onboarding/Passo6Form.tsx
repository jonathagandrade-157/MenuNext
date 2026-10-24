"use client";

import { useActionState, useState } from "react";
import { savePasso6Action, skipOnboardingStepAction } from "@/lib/actions/onboarding";
import { initialStepState } from "@/lib/form-state";
import { Banknote, CreditCard, QrCode } from "lucide-react";
import { ChoiceCard, FieldLabel, inputClass, ErrorMessage, StepNavigation } from "@/components/onboarding/OnboardingShell";
import type { Restaurant } from "@/lib/tenant";

const skipStep6 = skipOnboardingStepAction.bind(null, 6);

export function Passo6Form({ restaurant }: { restaurant: Restaurant }) {
  const [state, formAction] = useActionState(savePasso6Action, initialStepState);
  const [pixEnabled, setPixEnabled] = useState(restaurant.payment_pix);

  return (
    <form action={formAction} className="space-y-4">
      <ChoiceCard
        icon={<QrCode className="h-5 w-5" aria-hidden />}
        title="Pix"
        description="O cliente paga direto na sua chave Pix."
        name="payment_pix"
        checked={pixEnabled}
        onChange={(e) => setPixEnabled(e.target.checked)}
      >
        {pixEnabled && (
          <span className="mt-3 block">
            <FieldLabel>Chave Pix do restaurante *</FieldLabel>
            <input
              name="payment_pix_key"
              type="text"
              defaultValue={restaurant.payment_pix_key ?? ""}
              placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória"
              className={inputClass}
            />
          </span>
        )}
      </ChoiceCard>

      <ChoiceCard
        icon={<Banknote className="h-5 w-5" aria-hidden />}
        title="Dinheiro"
        description="O cliente paga em espécie na entrega ou na retirada."
        name="payment_cash"
        defaultChecked={restaurant.payment_cash}
      />

      <ChoiceCard
        icon={<CreditCard className="h-5 w-5" aria-hidden />}
        title="Maquininha / cartão"
        description="Cartão na entrega ou retirada, com a sua maquininha."
        name="payment_card"
        defaultChecked={restaurant.payment_card}
      />

      <ErrorMessage message={state.status === "error" ? state.message : undefined} />

      <StepNavigation backHref="/onboarding/passo-5" skipAction={skipStep6} submitLabel="Salvar e continuar" />
    </form>
  );
}
