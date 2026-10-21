import Link from "next/link";
import { TrendingDown } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { formatCurrencyBRL } from "@/lib/orders";
import { LOW_MARGIN_THRESHOLD, TARGET_MARGIN, type MarginInsight } from "@/lib/insights";

export function MarginInsightCard({ insight }: { insight: MarginInsight }) {
  const { lowMargin, soldWithoutCost } = insight;

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <TrendingDown className="h-5 w-5 text-primary" aria-hidden />
        <h2 className="text-body-lg font-bold text-graphite">Margem baixa</h2>
      </div>
      <p className="mt-1 text-body-sm text-text-muted">
        Produtos vendidos no período com margem abaixo de {Math.round(LOW_MARGIN_THRESHOLD * 100)}% (custo cadastrado hoje).
      </p>

      {lowMargin.length === 0 ? (
        <p className="mt-3 text-body-md text-graphite">Nenhum produto vendido está abaixo da margem mínima.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {lowMargin.map((p) => (
            <li key={p.productId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-body-md font-semibold text-graphite">{p.name}</p>
                <p className="text-body-sm text-text-muted">
                  {p.quantitySold} vendidos · custo {formatCurrencyBRL(p.cost)} · preço {formatCurrencyBRL(p.price)} · margem{" "}
                  {p.marginPercent.toFixed(0)}%
                </p>
              </div>
              <p className="text-body-sm text-graphite">
                Para {Math.round(TARGET_MARGIN * 100)}% de margem: <strong>{formatCurrencyBRL(p.suggestedPrice)}</strong>
              </p>
            </li>
          ))}
        </ul>
      )}

      {soldWithoutCost > 0 && (
        <p className="mt-3 rounded-lg bg-surface-subdued p-3 text-body-sm text-graphite">
          {soldWithoutCost} {soldWithoutCost === 1 ? "produto vendeu" : "produtos venderam"} sem custo cadastrado, então não dá para
          calcular a margem. Preencha o custo em{" "}
          <Link href="/painel/produtos" className="font-semibold text-primary underline">
            Produtos
          </Link>
          .
        </p>
      )}
      {lowMargin.length > 0 && (
        <p className="mt-3 text-body-sm">
          <Link href="/painel/produtos" className="font-semibold text-primary underline">
            Ajustar preços em Produtos
          </Link>
        </p>
      )}
    </Card>
  );
}
