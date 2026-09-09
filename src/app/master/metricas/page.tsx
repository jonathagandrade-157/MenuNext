import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_5"
      title="Métricas da plataforma"
      description="Indicadores agregados de uso e receita do SaaS."
      backHref="/master"
      backLabel="Voltar ao dashboard Master"
    />
  );
}
