import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default async function Page({ params }: PageProps<"/loja/[slug]">) {
  const { slug } = await params;
  return (
    <ScreenPlaceholder
      screenId="SCREEN_30"
      title={`Loja pública — ${slug}`}
      description="Home do restaurante: banner, categorias e produtos do cardápio, sem exigir cadastro do cliente."
      backHref="/"
      backLabel="Voltar para a página inicial"
    />
  );
}
