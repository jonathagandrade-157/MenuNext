import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_17"
      title="Frente de caixa"
      description="Lançamento manual de pedidos de balcão e telefone."
      backHref="/painel"
      backLabel="Voltar ao dashboard"
    />
  );
}
