import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_7"
      title="Configurações da plataforma"
      description="Parâmetros globais do MenuNext."
      backHref="/master"
      backLabel="Voltar ao dashboard Master"
    />
  );
}
