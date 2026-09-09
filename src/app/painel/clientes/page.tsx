import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_19"
      title="Clientes"
      description="Base de clientes do restaurante, com histórico de pedidos."
      backHref="/painel"
      backLabel="Voltar ao dashboard"
    />
  );
}
