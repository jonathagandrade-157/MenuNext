import { requireOnboardingStep } from "@/lib/tenant";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { Passo1Form } from "@/components/onboarding/Passo1Form";

export default async function Passo1Page() {
  await requireOnboardingStep(1);

  return (
    <OnboardingShell
      step={1}
      title="Vamos configurar seu restaurante"
      description="Leva poucos minutos. Você poderá alterar qualquer dado depois no painel."
    >
      <Passo1Form />
    </OnboardingShell>
  );
}
