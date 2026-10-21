import { getCombosWithItems, getProducts, requireOwnerPage } from "@/lib/tenant";
import { getPublicAssetUrl } from "@/lib/storage/assets";
import { CombosClient } from "@/components/painel/combos/CombosClient";

export default async function CombosPage() {
  // Combos são do OWNER (P1-02): STAFF volta para /painel.
  const { supabase, restaurant } = await requireOwnerPage();

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
