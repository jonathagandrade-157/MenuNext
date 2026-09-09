import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_44"
      title="Onboarding — Passo 2: Endereço, CEP e confirmação no mapa"
      description="Localização do restaurante para cálculo de área de entrega."
      backHref="/onboarding/passo-1"
      backLabel="Voltar ao passo anterior"
    />
  );
}
