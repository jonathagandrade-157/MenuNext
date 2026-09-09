import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_35"
      title="Categorias do cardápio"
      description="Organização dos produtos por categoria (ex.: Burgers, Combos, Bebidas)."
      backHref="/painel"
      backLabel="Voltar ao dashboard"
    />
  );
}
