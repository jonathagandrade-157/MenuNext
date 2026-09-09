import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_41"
      title="Onboarding — Passo 5: Horários de funcionamento"
      description="Dias e turnos em que a loja recebe pedidos."
      backHref="/onboarding/passo-4"
      backLabel="Voltar ao passo anterior"
    />
  );
}
