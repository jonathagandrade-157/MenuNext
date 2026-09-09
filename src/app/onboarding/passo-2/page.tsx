import { requireOnboardingStep } from "@/lib/tenant";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { Passo2Form } from "@/components/onboarding/Passo2Form";

export default async function Passo2Page() {
  const { restaurant } = await requireOnboardingStep(2);

  return (
    <OnboardingShell step={2} title="Onde fica o seu restaurante?" description="Usamos esse endereço para calcular a área de entrega.">
      <Passo2Form restaurant={restaurant!} />
    </OnboardingShell>
  );
}
