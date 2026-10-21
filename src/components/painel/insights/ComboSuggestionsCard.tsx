import Link from "next/link";
import { Layers } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { formatCurrencyBRL } from "@/lib/orders";
import { COMBO_DISCOUNT, MIN_PAIR_ORDERS, type ComboSuggestion } from "@/lib/insights";

export function ComboSuggestionsCard({ suggestions }: { suggestions: ComboSuggestion[] }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Layers className="h-5 w-5 text-primary" aria-hidden />
        <h2 className="text-body-lg font-bold text-graphite">Combos sugeridos</h2>
      </div>
      <p className="mt-1 text-body-sm text-text-muted">
        Produtos que seus clientes pedem juntos (pelo menos {MIN_PAIR_ORDERS} pedidos) e que ainda não formam um combo.
      </p>

      {suggestions.length === 0 ? (
        <p className="mt-3 text-body-md text-graphite">Sem sugestões por enquanto. Elas aparecem quando um par se repete nos pedidos.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {suggestions.map((s) => (
            <li key={`${s.productAId}-${s.productBId}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-body-md font-semibold text-graphite">
                  {s.productAName} + {s.productBName}
                </p>
                <p className="text-body-sm text-text-muted">
                  Juntos em {s.pairOrders} pedidos ({Math.round(s.togetherPercent)}% dos pedidos do menos pedido dos dois)
                </p>
              </div>
              {s.regularPrice !== null && s.suggestedPrice !== null && (
                <p className="text-body-sm text-graphite">
                  <span className="text-text-muted line-through">{formatCurrencyBRL(s.regularPrice)}</span>{" "}
                  <strong>{formatCurrencyBRL(s.suggestedPrice)}</strong> com {Math.round(COMBO_DISCOUNT * 100)}% off
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-body-sm">
        <Link href="/painel/combos" className="font-semibold text-primary underline">
          Criar combo em Combos
        </Link>
      </p>
    </Card>
  );
}
