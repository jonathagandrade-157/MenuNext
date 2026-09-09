import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_15"
      title="Marketing e promoções"
      description="Cupons de desconto e campanhas para reativar clientes."
      backHref="/painel"
      backLabel="Voltar ao dashboard"
    />
  );
}
