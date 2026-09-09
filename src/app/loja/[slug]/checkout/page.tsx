import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default async function Page({ params }: PageProps<"/loja/[slug]/checkout">) {
  const { slug } = await params;
  return (
    <ScreenPlaceholder
      screenId="SCREEN_28"
      title="Checkout"
      description="Dados de entrega ou retirada e forma de pagamento (Pix, dinheiro ou cartão)."
      backHref={`/loja/${slug}/sacola`}
      backLabel="Voltar para a sacola"
    />
  );
}
