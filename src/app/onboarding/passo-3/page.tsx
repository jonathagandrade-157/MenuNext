import { requireOnboardingStep } from "@/lib/tenant";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { Passo3Form } from "@/components/onboarding/Passo3Form";

export default async function Passo3Page() {
  const { restaurant } = await requireOnboardingStep(3);

  return (
    <OnboardingShell step={3} title="Como você atende seus clientes?" description="Selecione uma ou as duas opções.">
      <Passo3Form restaurant={restaurant!} />
    </OnboardingShell>
  );
}
