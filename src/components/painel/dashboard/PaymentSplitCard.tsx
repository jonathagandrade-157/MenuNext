import { Card } from "@/components/ui/Card";
import type { PaymentSplit } from "@/lib/dashboard";

const LABELS: Record<keyof PaymentSplit, string> = { pix: "Pix", cash: "Dinheiro", card: "Cartão" };

export function PaymentSplitCard({ split }: { split: PaymentSplit }) {
  const total = split.pix.count + split.cash.count + split.card.count;

  return (
    <Card className="p-5">
      <h2 className="text-sm font-extrabold text-graphite">Formas de pagamento hoje</h2>

      {total === 0 ? (
        <p className="mt-3 text-sm text-text-muted">Nenhum pedido hoje ainda.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {(Object.keys(LABELS) as (keyof PaymentSplit)[]).map((method) => {
            const percent = Math.round((split[method].count / total) * 100);
            return (
              <div key={method}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-graphite">{LABELS[method]}</span>
                  <span className="text-text-muted">{percent}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-subdued">
                  <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
