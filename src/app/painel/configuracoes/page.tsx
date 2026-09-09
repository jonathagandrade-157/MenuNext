import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_13"
      title="Configurações gerais"
      description="Dados cadastrais e preferências gerais do restaurante."
      backHref="/painel"
      backLabel="Voltar ao dashboard"
    />
  );
}
