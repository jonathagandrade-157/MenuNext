import { getCategories, getCategoryProductCounts, requireOwnerPage } from "@/lib/tenant";
import { CategoriasClient } from "@/components/painel/categorias/CategoriasClient";

export default async function CategoriasPage() {
  // Categorias são do OWNER (P1-02): STAFF volta para /painel.
  const { supabase, restaurant } = await requireOwnerPage();

  const [categories, productCounts] = await Promise.all([
    getCategories(supabase, restaurant.id),
    getCategoryProductCounts(supabase, restaurant.id),
  ]);

  return <CategoriasClient initialCategories={categories} productCounts={productCounts} storeSlug={restaurant.slug} />;
}
