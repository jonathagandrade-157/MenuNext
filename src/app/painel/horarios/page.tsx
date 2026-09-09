import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_22"
      title="Horários de funcionamento"
      description="Dias e turnos de funcionamento da loja, com pausa de emergência."
      backHref="/painel"
      backLabel="Voltar ao dashboard"
    />
  );
}
