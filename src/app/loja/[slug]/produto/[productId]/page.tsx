import type { Metadata } from "next";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getPublicAssetUrl } from "@/lib/storage/assets";
import {
  computeStoreOpenState,
  getPublicBusinessHours,
  getPublicProductDetail,
} from "@/lib/store";
import { getCachedPublicRestaurant } from "@/lib/storeRestaurant";
import { ProductDetailClient } from "@/components/loja/ProductDetailClient";
import { StoreNotFound } from "@/components/loja/StoreNotFound";
import { StoreProductNotFound } from "@/components/loja/StoreProductNotFound";

/** Detalhe do produto, uma consulta por requisição (o título da aba e a página pedem o mesmo dado). */
const loadProduct = cache(async (slug: string, productId: string) => {
  const restaurant = await getCachedPublicRestaurant(slug);
  if (!restaurant) return null;
  const supabase = await createClient();
  return getPublicProductDetail(supabase, restaurant.id, productId, (path) => getPublicAssetUrl(supabase, path));
});

export async function generateMetadata({
  params,
}: PageProps<"/loja/[slug]/produto/[productId]">): Promise<Metadata> {
  const { slug, productId } = await params;
  try {
    const [restaurant, product] = await Promise.all([getCachedPublicRestaurant(slug), loadProduct(slug, productId)]);
    if (!restaurant || !product) return {};
    const title = `${product.name} — ${restaurant.name}`;
    const description = product.description?.trim() || `Peça ${product.name} em ${restaurant.name}.`;
    const images = product.images.length > 0 ? [product.images[0].url] : undefined;
    return {
      title,
      description,
      openGraph: { type: "website", locale: "pt_BR", siteName: restaurant.name, title, description, images },
      twitter: { card: images ? "summary_large_image" : "summary", title, description, images },
    };
  } catch {
    return {};
  }
}

export default async function ProdutoPublicoPage({ params }: PageProps<"/loja/[slug]/produto/[productId]">) {
  const { slug, productId } = await params;
  const supabase = await createClient();

  const restaurant = await getCachedPublicRestaurant(slug);
  if (!restaurant) return <StoreNotFound />;

  // Estruturalmente validado dentro de getPublicProductDetail: o produto só
  // é retornado se restaurant_id bater com o restaurante do slug — nunca
  // busca só por productId.
  const [product, businessHours] = await Promise.all([
    loadProduct(slug, productId),
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
