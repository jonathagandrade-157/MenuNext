import { requireOwnerPage } from "@/lib/tenant";
import { getProducts } from "@/lib/tenant";
import { getVariants, groupByProduct } from "@/lib/variants";
import { VariantesClient } from "@/components/painel/variantes/VariantesClient";
import { EmptyState } from "@/components/ui/States";

export default async function VariantesPage() {
  const { supabase, restaurant } = await requireOwnerPage();
  const [products, result] = await Promise.all([getProducts(supabase, restaurant.id), getVariants(supabase, restaurant.id)]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-headline-lg text-graphite">Variantes</h1>
        <p className="mt-0.5 text-body-md text-text-muted">Tamanhos e versões do mesmo produto, cada uma com preço e disponibilidade próprios.</p>
      </div>
      {result.available ? (
        <VariantesClient
          products={products.map((p) => ({ id: p.id, name: p.name, price: Number(p.price) }))}
          variants={Object.fromEntries(groupByProduct(result.variants))}
        />
      ) : (
        <EmptyState title="Variantes indisponíveis neste ambiente." description="A migration de variantes ainda não foi aplicada." />
      )}
    </div>
  );
}
