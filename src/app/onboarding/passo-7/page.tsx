import { requireOnboardingStep } from "@/lib/tenant";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { Passo7Form } from "@/components/onboarding/Passo7Form";

export default async function Passo7Page() {
  await requireOnboardingStep(7);

  return (
    <OnboardingShell step={7} title="Cadastre seu primeiro produto" description="Assim sua loja não fica vazia quando for publicada.">
      <Passo7Form />
    </OnboardingShell>
  );
}
