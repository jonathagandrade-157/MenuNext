import { requireOnboardingStep, getBusinessHours } from "@/lib/tenant";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { Passo5Form } from "@/components/onboarding/Passo5Form";

export default async function Passo5Page() {
  const { supabase, restaurant } = await requireOnboardingStep(5);
  const businessHours = await getBusinessHours(supabase, restaurant!.id);

  return (
    <OnboardingShell step={5} title="Horários de funcionamento" description="Configure os dias e horários em que sua loja recebe pedidos.">
      <Passo5Form businessHours={businessHours} />
    </OnboardingShell>
  );
}
