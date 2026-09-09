import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_25"
      title="Pedidos — Kanban operacional"
      description="Colunas Novos, Em Preparação, Prontos, Saiu para Entrega e Entregues."
      backHref="/painel"
      backLabel="Voltar ao dashboard"
    />
  );
}
