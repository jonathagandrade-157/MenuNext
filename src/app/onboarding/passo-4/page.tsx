import { requireOnboardingStep } from "@/lib/tenant";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { Passo4Form } from "@/components/onboarding/Passo4Form";

export default async function Passo4Page() {
  const { restaurant } = await requireOnboardingStep(4);

  return (
    <OnboardingShell step={4} title="Configure o delivery" description="Defina a taxa e o raio de entrega do seu restaurante.">
      <Passo4Form restaurant={restaurant!} />
    </OnboardingShell>
  );
}
