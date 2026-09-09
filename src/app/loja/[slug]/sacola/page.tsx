import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default async function Page({ params }: PageProps<"/loja/[slug]/sacola">) {
  const { slug } = await params;
  return (
    <ScreenPlaceholder
      screenId="SCREEN_29"
      title="Sacola do pedido"
      description="Itens escolhidos, adicionais, subtotal e taxa de entrega antes do checkout."
      backHref={`/loja/${slug}`}
      backLabel="Voltar para a loja"
    />
  );
}
