import { requireOwnerPage } from "@/lib/tenant";
import { getStockOverview } from "@/lib/stock";
import { EstoqueClient } from "@/components/painel/estoque/EstoqueClient";

export default async function EstoquePage() {
  // Estoque é do OWNER (mesmo padrão de categorias/combos): STAFF volta para /painel.
  const { supabase, restaurant } = await requireOwnerPage();
  const overview = await getStockOverview(supabase, restaurant.id);
  return <EstoqueClient rows={overview.rows} movements={overview.movements} />;
}
