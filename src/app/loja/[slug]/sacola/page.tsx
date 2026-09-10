import { createClient } from "@/lib/supabase/server";
import { computeStoreOpenState, getPublicBusinessHours, getPublicRestaurantBySlug } from "@/lib/store";
import { SacolaClient } from "@/components/loja/SacolaClient";
import { StoreNotFound } from "@/components/loja/StoreNotFound";

export default async function Page({ params }: PageProps<"/loja/[slug]/sacola">) {
  const { slug } = await params;
  const supabase = await createClient();

  const restaurant = await getPublicRestaurantBySlug(supabase, slug);
  if (!restaurant) return <StoreNotFound />;

  const businessHours = await getPublicBusinessHours(supabase, restaurant.id);
  const openState = computeStoreOpenState(restaurant.status, businessHours);
  const canCheckout = openState.status === "open";
  const unavailableReason =
    openState.status === "paused"
      ? "Esta loja está pausada temporariamente e não está aceitando novos pedidos agora."
      : openState.status === "closed_permanently"
        ? "Esta loja está encerrada e não está aceitando novos pedidos."
        : openState.status === "closed_hours"
          ? "Esta loja está fechada no momento. Volte durante o horário de funcionamento para finalizar o pedido."
          : null;

  return <SacolaClient slug={slug} canCheckout={canCheckout} unavailableReason={unavailableReason} />;
}
