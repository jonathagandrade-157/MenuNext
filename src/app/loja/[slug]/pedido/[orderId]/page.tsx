import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default async function Page({ params }: PageProps<"/loja/[slug]/pedido/[orderId]">) {
  const { slug } = await params;
  return (
    <ScreenPlaceholder
      screenId="SCREEN_27"
      title="Pedido confirmado"
      description="Confirmação do pedido enviado ao restaurante, com número e resumo."
      backHref={`/loja/${slug}`}
      backLabel="Voltar para a loja"
    />
  );
}
