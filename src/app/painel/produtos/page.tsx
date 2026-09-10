import { redirect } from "next/navigation";
import {
  getAddonGroupsWithAddons,
  getAuthedUser,
  getCategories,
  getMyRestaurant,
  getProductAddonGroupsForRestaurant,
  getProductsWithImages,
} from "@/lib/tenant";
import { getPublicAssetUrl } from "@/lib/storage/assets";
import { ProdutosClient } from "@/components/painel/produtos/ProdutosClient";

export default async function ProdutosPage() {
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const [products, categories, addonGroups, productAddonGroups] = await Promise.all([
    getProductsWithImages(supabase, restaurant.id),
    getCategories(supabase, restaurant.id),
    getAddonGroupsWithAddons(supabase, restaurant.id),
    getProductAddonGroupsForRestaurant(supabase, restaurant.id),
  ]);

  const productsWithUrls = products.map((product) => ({
    ...product,
    product_images: [...product.product_images]
      .sort((a, b) => a.display_order - b.display_order)
      .map((image) => ({ ...image, url: getPublicAssetUrl(supabase, image.storage_path) })),
  }));

  return (
    <ProdutosClient
      initialProducts={productsWithUrls}
      categories={categories}
      addonGroups={addonGroups}
      productAddonGroups={productAddonGroups}
    />
  );
}
