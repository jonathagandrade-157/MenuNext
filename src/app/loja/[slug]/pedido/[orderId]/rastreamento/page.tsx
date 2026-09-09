import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default async function Page({ params }: PageProps<"/loja/[slug]/pedido/[orderId]/rastreamento">) {
  const { slug, orderId } = await params;
  return (
    <ScreenPlaceholder
      screenId="SCREEN_26"
      title="Rastreamento do pedido"
      description="Acompanhamento do status do pedido em tempo real, do recebimento à entrega."
      backHref={`/loja/${slug}/pedido/${orderId}`}
      backLabel="Voltar para o pedido"
    />
  );
}
