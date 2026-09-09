import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_43"
      title="Onboarding — Passo 3: Formas de atendimento"
      description="Delivery, retirada no balcão ou ambos."
      backHref="/onboarding/passo-2"
      backLabel="Voltar ao passo anterior"
    />
  );
}
