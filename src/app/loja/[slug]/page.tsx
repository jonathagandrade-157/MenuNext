import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPublicAssetUrl } from "@/lib/storage/assets";
import {
  computeStoreOpenState,
  getPublicBusinessHours,
  getPublicCategoriesWithProducts,
  getPublicCombosWithItems,
  getPublicRestaurantBySlug,
} from "@/lib/store";
import { StoreBagAside } from "@/components/loja/StoreBagAside";
import { StoreBagBar } from "@/components/loja/StoreBagBar";
import { StoreBottomNav } from "@/components/loja/StoreBottomNav";
import { StoreCatalog } from "@/components/loja/StoreCatalog";
import { StoreHeader } from "@/components/loja/StoreHeader";
import { StoreNotFound } from "@/components/loja/StoreNotFound";
import { StoreOpenBadge } from "@/components/loja/StoreOpenBadge";
import { StoreWhatsAppButton } from "@/components/loja/StoreWhatsAppButton";

export default async function LojaPublicaPage({ params }: PageProps<"/loja/[slug]">) {
  const { slug } = await params;
  const supabase = await createClient();

  const restaurant = await getPublicRestaurantBySlug(supabase, slug);
  if (!restaurant) return <StoreNotFound />;

  // Assinatura do lojista atrasada/cancelada (decisão tomada com o
  // usuário): bloqueia a loja pública inteira, nunca só o painel — o
  // cliente final não vê o cardápio nem consegue navegar.
  if (restaurant.subscription_blocked) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="rounded-full bg-surface-subdued px-3 py-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
          Loja indisponível
        </span>
        <h1 className="text-xl font-extrabold text-graphite">Esta loja está temporariamente indisponível</h1>
        <p className="max-w-xs text-sm text-text-muted">Volte mais tarde.</p>
      </div>
    );
  }

  const getImageUrl = (path: string) => getPublicAssetUrl(supabase, path);

  const [categories, combos, businessHours] = await Promise.all([
    getPublicCategoriesWithProducts(supabase, restaurant.id, getImageUrl),
    getPublicCombosWithItems(supabase, restaurant.id, getImageUrl),
    getPublicBusinessHours(supabase, restaurant.id),
  ]);

  const openState = computeStoreOpenState(restaurant.status, businessHours);
  const hasAnyProduct = categories.some((category) => category.products.length > 0);
  const isBrowsable = openState.status !== "closed_permanently";

  // Cor de destaque por restaurante (área "Aparência" do redesign) — override
  // inline de --color-primary só nesta subárvore, nunca no globals.css
  // (compartilhado pelo painel de TODOS os restaurantes). O "Next" da marca
  // MenuNext no rodapé usa uma cor fixa (não text-primary) de propósito, para
  // não ser recolorido junto com a marca do restaurante.
  const themeStyle = restaurant.theme_primary_color
    ? ({
        "--color-primary": restaurant.theme_primary_color,
        "--color-primary-container": `color-mix(in srgb, ${restaurant.theme_primary_color} 82%, white)`,
      } as React.CSSProperties)
    : undefined;

  return (
    <div className="pb-36 lg:pb-8" style={themeStyle}>
      <StoreHeader
        name={restaurant.name}
        bio={restaurant.bio}
        coverUrl={restaurant.cover_path ? getImageUrl(restaurant.cover_path) : null}
        logoUrl={restaurant.logo_path ? getImageUrl(restaurant.logo_path) : null}
        openState={openState}
        serviceDelivery={restaurant.service_delivery}
        deliveryFee={restaurant.delivery_fee}
        deliveryRadiusKm={restaurant.delivery_radius_km}
        estimatedDeliveryMinMinutes={restaurant.estimated_delivery_min_minutes}
        estimatedDeliveryMaxMinutes={restaurant.estimated_delivery_max_minutes}
        servicePickup={restaurant.service_pickup}
        minimumOrderValue={restaurant.minimum_order_value}
      />

      {openState.status === "closed_hours" && (
        <div className="mx-3.5 mt-3 rounded-xl border border-border bg-surface-subdued px-3.5 py-2.5 text-xs font-medium text-text-muted">
          Esta loja está fechada no momento. Você pode navegar pelo cardápio, mas novos pedidos não estão disponíveis
          agora.
        </div>
      )}

      {!isBrowsable ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <StoreOpenBadge state={openState} />
          <p className="max-w-xs text-sm text-text-muted">
            Esta loja não está recebendo pedidos no momento. Volte mais tarde.
          </p>
        </div>
      ) : !hasAnyProduct && combos.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <p className="font-semibold text-graphite">Cardápio em preparação</p>
          <p className="max-w-xs text-sm text-text-muted">Esta loja ainda não cadastrou produtos no cardápio.</p>
        </div>
      ) : (
        <>
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-2">
            <div>
              <StoreCatalog slug={slug} categories={categories} combos={combos} />
            </div>
            <StoreBagAside slug={slug} />
          </div>
        </>
      )}

      <p className="px-3.5 py-6 text-center text-label-md text-text-muted">
        Tecnologia de pedidos online por Menu<span className="text-[#ab2f00]">Next</span>
        {" · "}
        <Link href="/privacidade" className="underline">
          Privacidade
        </Link>
      </p>

      {restaurant.contact_whatsapp && <StoreWhatsAppButton whatsapp={restaurant.contact_whatsapp} storeName={restaurant.name} />}

      <StoreBagBar slug={slug} />
      <StoreBottomNav slug={slug} />
    </div>
  );
}
