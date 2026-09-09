import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_14"
      title="Usuários e permissões"
      description="Gestão da equipe com acesso ao painel do restaurante."
      backHref="/painel"
      backLabel="Voltar ao dashboard"
    />
  );
}
