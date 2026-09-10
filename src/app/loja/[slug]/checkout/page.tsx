import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { computeStoreOpenState, getPublicBusinessHours, getPublicRestaurantBySlug } from "@/lib/store";
import { CheckoutClient } from "@/components/loja/CheckoutClient";
import { StoreNotFound } from "@/components/loja/StoreNotFound";

export default async function Page({ params }: PageProps<"/loja/[slug]/checkout">) {
  const { slug } = await params;
  const supabase = await createClient();

  const restaurant = await getPublicRestaurantBySlug(supabase, slug);
  if (!restaurant) return <StoreNotFound />;

  const businessHours = await getPublicBusinessHours(supabase, restaurant.id);
  const openState = computeStoreOpenState(restaurant.status, businessHours);

  // O checkout só é liberado com a loja realmente "open" — mesma regra que
  // já bloqueia adicionar produto à sacola (ProdutoPublicoPage). Nunca
  // renderiza o formulário se a RPC create_order já vai recusar de
  // qualquer forma.
  if (openState.status !== "open") {
    const reason =
      openState.status === "paused"
        ? "Esta loja está pausada temporariamente e não está aceitando pedidos agora."
        : openState.status === "closed_permanently"
          ? "Esta loja está encerrada e não está aceitando pedidos."
          : "Esta loja está fechada no momento. Volte durante o horário de funcionamento para finalizar o pedido.";

    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-lg font-extrabold text-graphite">Não é possível finalizar o pedido agora</h1>
        <p className="max-w-xs text-sm text-text-muted">{reason}</p>
        <Link href={`/loja/${slug}/sacola`} className="text-sm font-semibold text-primary hover:underline">
          ← Voltar para a sacola
        </Link>
      </div>
    );
  }

  return (
    <CheckoutClient
      slug={slug}
      serviceDelivery={restaurant.service_delivery}
      servicePickup={restaurant.service_pickup}
      deliveryFee={restaurant.delivery_fee}
      paymentPix={restaurant.payment_pix}
      paymentCash={restaurant.payment_cash}
      paymentCard={restaurant.payment_card}
    />
  );
}
