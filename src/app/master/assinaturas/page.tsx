import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_8"
      title="Assinaturas"
      description="Assinaturas SaaS ativas, planos e cobrança dos restaurantes."
      backHref="/master"
      backLabel="Voltar ao dashboard Master"
    />
  );
}
