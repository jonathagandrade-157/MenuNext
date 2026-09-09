import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_31"
      title="Combos"
      description="Combinações promocionais de produtos com preço especial."
      backHref="/painel"
      backLabel="Voltar ao dashboard"
    />
  );
}
