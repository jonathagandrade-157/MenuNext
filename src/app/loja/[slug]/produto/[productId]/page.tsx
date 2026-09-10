import { createClient } from "@/lib/supabase/server";
import { getPublicAssetUrl } from "@/lib/storage/assets";
import {
  computeStoreOpenState,
  getPublicBusinessHours,
  getPublicProductDetail,
  getPublicRestaurantBySlug,
} from "@/lib/store";
import { ProductDetailClient } from "@/components/loja/ProductDetailClient";
import { StoreNotFound } from "@/components/loja/StoreNotFound";
import { StoreProductNotFound } from "@/components/loja/StoreProductNotFound";

export default async function ProdutoPublicoPage({ params }: PageProps<"/loja/[slug]/produto/[productId]">) {
  const { slug, productId } = await params;
  const supabase = await createClient();

  const restaurant = await getPublicRestaurantBySlug(supabase, slug);
  if (!restaurant) return <StoreNotFound />;

  const getImageUrl = (path: string) => getPublicAssetUrl(supabase, path);

  // Estruturalmente validado dentro de getPublicProductDetail: o produto só
  // é retornado se restaurant_id bater com o restaurante do slug — nunca
  // busca só por productId.
  const [product, businessHours] = await Promise.all([
    getPublicProductDetail(supabase, restaurant.id, productId, getImageUrl),
    getPublicBusinessHours(supabase, restaurant.id),
  ]);

  if (!product) return <StoreProductNotFound slug={slug} />;

  const openState = computeStoreOpenState(restaurant.status, businessHours);
  const canAddToBag = openState.status === "open";
  const unavailableReason =
    openState.status === "paused"
      ? "Esta loja está pausada temporariamente e não está aceitando novos itens agora."
      : openState.status === "closed_permanently"
        ? "Esta loja está encerrada e não está aceitando novos itens."
        : openState.status === "closed_hours"
          ? "Esta loja está fechada no momento. Volte durante o horário de funcionamento para adicionar itens."
          : null;

  return <ProductDetailClient product={product} canAddToBag={canAddToBag} unavailableReason={unavailableReason} />;
}
