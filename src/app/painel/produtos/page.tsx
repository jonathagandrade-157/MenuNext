import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_34"
      title="Produtos"
      description="Lista de produtos do cardápio, com foto, preço e disponibilidade."
      backHref="/painel"
      backLabel="Voltar ao dashboard"
    />
  );
}
