import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_9"
      title="Detalhes do restaurante"
      description="Dados, plano e status de um restaurante específico, visão do Master."
      backHref="/master/restaurantes"
      backLabel="Voltar para restaurantes"
    />
  );
}
