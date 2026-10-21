import { getCombosWithItems, getProducts, requireOwnerPage } from "@/lib/tenant";
import {
  INSIGHTS_WINDOW_DAYS,
  computeComboSuggestions,
  computeMarginInsight,
  computePeakInsight,
  getInsightOrders,
} from "@/lib/insights";
import { PeakCard } from "@/components/painel/insights/PeakCard";
import { MarginInsightCard } from "@/components/painel/insights/MarginInsightCard";
import { ComboSuggestionsCard } from "@/components/painel/insights/ComboSuggestionsCard";

// Restrita ao OWNER: mexe em preço, combo e cupom.
export default async function InsightsPage() {
  const { supabase, restaurant } = await requireOwnerPage();

  const [orders, products, combos] = await Promise.all([
    getInsightOrders(supabase, restaurant.id),
    getProducts(supabase, restaurant.id),
    getCombosWithItems(supabase, restaurant.id),
  ]);

  const peak = computePeakInsight(orders);
  const margin = computeMarginInsight(orders, products);
  const comboSuggestions = computeComboSuggestions(orders, products, combos);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-headline-lg text-graphite">Insights</h1>
        <p className="text-body-md text-text-muted">
          O que as vendas dos últimos {INSIGHTS_WINDOW_DAYS} dias mostram e o que fazer com isso.
        </p>
      </div>

      <PeakCard peak={peak} />
      <MarginInsightCard insight={margin} />
      <ComboSuggestionsCard suggestions={comboSuggestions} />
    </div>
  );
}
