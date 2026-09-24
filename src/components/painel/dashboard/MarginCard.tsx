import { Card } from "@/components/ui/Card";
import { formatCurrencyBRL } from "@/lib/orders";
import type { EstimatedMargin } from "@/lib/dashboard";

/**
 * Margem estimada (redesign Stitch) — "estimada" porque usa o custo
 * CADASTRADO ATUAL do produto, não um snapshot histórico (order_items não
 * guarda custo no momento da venda). Quando nenhum produto vendido hoje tem
 * custo cadastrado, mostra um estado explicando em vez de uma margem falsa.
 */
export function MarginCard({ margin }: { margin: EstimatedMargin | null }) {
  return (
    <Card className="p-5">
      <h2 className="text-sm font-extrabold text-graphite">Margem estimada</h2>

      {margin === null ? (
        <p className="mt-3 text-sm text-text-muted">
          Cadastre o custo dos produtos vendidos hoje em{" "}
          <a href="/painel/produtos" className="font-semibold text-primary hover:underline">
            Produtos
          </a>{" "}
          para ver a margem estimada aqui.
        </p>
      ) : (
        <>
          <p className="mt-2 text-2xl font-black text-graphite">{margin.marginPercent.toFixed(1)}%</p>
          <p className="mt-1 text-xs text-text-muted">
            Faturamento com custo: {formatCurrencyBRL(margin.revenue)} • Custo: {formatCurrencyBRL(margin.cost)}
          </p>
          <p className="mt-2 text-[11px] text-text-muted">Estimativa com base no custo cadastrado atual dos produtos.</p>
        </>
      )}
    </Card>
  );
}
