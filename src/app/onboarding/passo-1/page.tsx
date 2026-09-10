import { requireOnboardingStep } from "@/lib/tenant";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { Passo1Form } from "@/components/onboarding/Passo1Form";

export default async function Passo1Page(props: PageProps<"/onboarding/passo-1">) {
  await requireOnboardingStep(1);

  const searchParams = await props.searchParams;
  const showWelcome = searchParams.welcome === "1";

  return (
    <OnboardingShell
      step={1}
      title="Vamos configurar seu restaurante"
      description="Leva poucos minutos. Você poderá alterar qualquer dado depois no painel."
      successMessage={showWelcome ? "Conta criada! Vamos configurar sua loja." : undefined}
    >
      <Passo1Form />
    </OnboardingShell>
  );
}
