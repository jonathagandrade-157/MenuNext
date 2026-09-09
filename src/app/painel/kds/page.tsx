import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_16"
      title="Cozinha (KDS)"
      description="Painel de produção da cozinha com os pedidos em preparo."
      backHref="/painel"
      backLabel="Voltar ao dashboard"
    />
  );
}
