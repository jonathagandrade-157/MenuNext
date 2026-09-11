import { requireOnboardingStep, getCategories } from "@/lib/tenant";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { Passo7Form } from "@/components/onboarding/Passo7Form";

export default async function Passo7Page() {
  const { supabase, restaurant } = await requireOnboardingStep(7);
  const categories = await getCategories(supabase, restaurant!.id);

  return (
    <OnboardingShell
      step={7}
      title="Cadastre seu primeiro produto"
      description="Opcional — assim sua loja não fica vazia quando for publicada. Você pode pular e cadastrar depois no painel."
    >
      <Passo7Form categories={categories} />
    </OnboardingShell>
  );
}
