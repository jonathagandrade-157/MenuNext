import { requireOnboardingStep } from "@/lib/tenant";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { Passo6Form } from "@/components/onboarding/Passo6Form";

export default async function Passo6Page() {
  const { restaurant } = await requireOnboardingStep(6);

  return (
    <OnboardingShell step={6} title="Formas de pagamento" description="Selecione como seus clientes podem pagar o pedido.">
      <Passo6Form restaurant={restaurant!} />
    </OnboardingShell>
  );
}
