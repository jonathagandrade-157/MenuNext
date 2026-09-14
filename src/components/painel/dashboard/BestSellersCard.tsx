import { Card } from "@/components/ui/Card";
import { formatCurrencyBRL } from "@/lib/orders";
import type { BestSellerProduct } from "@/lib/bestsellers";

/**
 * "Produtos mais vendidos" (Sprint 4, Etapa 4) — ranking real vindo de
 * aggregateBestSellers (src/lib/bestsellers.ts), só pedidos válidos (não
 * cancelados). Nunca mostra dado fictício: sem pedido válido, mostra o
 * estado vazio.
 */
export function BestSellersCard({ products }: { products: BestSellerProduct[] }) {
  return (
    <Card className="p-6">
      <h2 className="text-base font-extrabold text-graphite">Produtos mais vendidos</h2>

      {products.length === 0 ? (
        <p className="py-10 text-center text-sm text-text-muted">
          Ainda não há vendas suficientes para montar um ranking.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {products.map((product, index) => (
            <li key={product.productKey} className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-subdued text-xs font-bold text-text-muted">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-graphite">{product.productName}</p>
                  <p className="text-xs text-text-muted">{product.quantitySold} vendidos</p>
                </div>
              </div>
              <p className="shrink-0 text-sm font-bold text-graphite">{formatCurrencyBRL(product.revenue)}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
