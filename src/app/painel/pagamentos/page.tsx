import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_21"
      title="Pagamentos"
      description="Chave Pix do restaurante e formas de pagamento aceitas."
      backHref="/painel"
      backLabel="Voltar ao dashboard"
    />
  );
}
