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
  //
  // Delivery-first (Fase 4.1): o MVP não oferece retirada como opção ao
  // cliente — se a loja não tem delivery ativo, não há um checkout possível
  // aqui, mesmo com service_pickup = true no banco (retirada não é
  // destruída, só deixou de ser um fluxo do cliente nesta fase).
  const reason =
    openState.status === "paused"
      ? "Esta loja está pausada temporariamente e não está aceitando pedidos agora."
      : openState.status === "closed_permanently"
        ? "Esta loja está encerrada e não está aceitando pedidos."
        : openState.status !== "open"
          ? "Esta loja está fechada no momento. Volte durante o horário de funcionamento para finalizar o pedido."
          : !restaurant.service_delivery
            ? "Esta loja não está com o delivery disponível no momento."
            : null;

  if (reason) {
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
      deliveryFee={restaurant.delivery_fee}
      deliveryFeeMethod={restaurant.delivery_fee_method}
      deliveryRadiusKm={restaurant.delivery_radius_km}
      minimumOrderValue={restaurant.minimum_order_value}
      paymentPix={restaurant.payment_pix}
      paymentCash={restaurant.payment_cash}
      paymentCard={restaurant.payment_card}
    />
  );
}
