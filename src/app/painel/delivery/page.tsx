import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_23"
      title="Delivery e taxas"
      description="Área de entrega, taxa fixa ou por bairro e valor mínimo do pedido."
      backHref="/painel"
      backLabel="Voltar ao dashboard"
    />
  );
}
