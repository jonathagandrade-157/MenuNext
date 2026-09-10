import { createClient } from "@/lib/supabase/server";
import { getPublicAssetUrl } from "@/lib/storage/assets";
import {
  computeStoreOpenState,
  getPublicBusinessHours,
  getPublicCategoriesWithProducts,
  getPublicCombosWithItems,
  getPublicRestaurantBySlug,
} from "@/lib/store";
import { StoreBottomNav } from "@/components/loja/StoreBottomNav";
import { StoreCategoryNav } from "@/components/loja/StoreCategoryNav";
import { StoreComboCard } from "@/components/loja/StoreComboCard";
import { StoreHeader } from "@/components/loja/StoreHeader";
import { StoreNotFound } from "@/components/loja/StoreNotFound";
import { StoreOpenBadge } from "@/components/loja/StoreOpenBadge";
import { StoreProductCard } from "@/components/loja/StoreProductCard";

export default async function LojaPublicaPage({ params }: PageProps<"/loja/[slug]">) {
  const { slug } = await params;
  const supabase = await createClient();

  const restaurant = await getPublicRestaurantBySlug(supabase, slug);
  if (!restaurant) return <StoreNotFound />;

  const getImageUrl = (path: string) => getPublicAssetUrl(supabase, path);

  const [categories, combos, businessHours] = await Promise.all([
    getPublicCategoriesWithProducts(supabase, restaurant.id, getImageUrl),
    getPublicCombosWithItems(supabase, restaurant.id, getImageUrl),
    getPublicBusinessHours(supabase, restaurant.id),
  ]);

  const openState = computeStoreOpenState(restaurant.status, businessHours);
  const hasAnyProduct = categories.some((category) => category.products.length > 0);
  const isBrowsable = openState.status !== "closed_permanently";

  return (
    <div className="pb-24">
      <StoreHeader
        name={restaurant.name}
        coverUrl={restaurant.cover_path ? getImageUrl(restaurant.cover_path) : null}
        logoUrl={restaurant.logo_path ? getImageUrl(restaurant.logo_path) : null}
        openState={openState}
        serviceDelivery={restaurant.service_delivery}
        servicePickup={restaurant.service_pickup}
        deliveryFee={restaurant.delivery_fee}
        deliveryRadiusKm={restaurant.delivery_radius_km}
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
          <StoreCategoryNav categories={categories.filter((c) => c.products.length > 0)} hasCombos={combos.length > 0} />

          {combos.length > 0 && (
            <section id="combos" className="px-3.5 py-4">
              <h2 className="mb-3 text-base font-extrabold tracking-tight text-graphite">🍱 Combos</h2>
              <div className="space-y-3">
                {combos.map((combo) => (
                  <StoreComboCard key={combo.id} combo={combo} />
                ))}
              </div>
            </section>
          )}

          {categories.map((category) =>
            category.products.length === 0 ? null : (
              <section key={category.id} id={`categoria-${category.id}`} className="px-3.5 py-4">
                <h2 className="mb-3 text-base font-extrabold tracking-tight text-graphite">{category.name}</h2>
                <div className="space-y-3">
                  {category.products.map((product) => (
                    <StoreProductCard
                      key={product.id}
                      name={product.name}
                      description={product.description}
                      price={product.price}
                      imageUrl={product.imageUrl}
                      isAvailable={product.is_available}
                    />
                  ))}
                </div>
              </section>
            )
          )}
        </>
      )}

      <p className="px-3.5 py-6 text-center text-[11px] font-medium text-text-muted">
        Tecnologia de pedidos online por Menu<span className="text-primary">Next</span>
      </p>

      <StoreBottomNav slug={slug} />
    </div>
  );
}
