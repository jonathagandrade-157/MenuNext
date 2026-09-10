import { redirect } from "next/navigation";
import { getAuthedUser, getCombosWithItems, getMyRestaurant, getProducts } from "@/lib/tenant";
import { getPublicAssetUrl } from "@/lib/storage/assets";
import { CombosClient } from "@/components/painel/combos/CombosClient";

export default async function CombosPage() {
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const [combos, products] = await Promise.all([
    getCombosWithItems(supabase, restaurant.id),
    getProducts(supabase, restaurant.id),
  ]);

  const combosWithUrls = combos.map((combo) => ({
    ...combo,
    imageUrl: combo.image_path ? getPublicAssetUrl(supabase, combo.image_path) : null,
  }));

  return <CombosClient initialCombos={combosWithUrls} products={products} />;
}
