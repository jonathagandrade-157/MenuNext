import { Card } from "@/components/ui/Card";
import type { ChannelSplit } from "@/lib/dashboard";

export function ChannelSplitCard({ split }: { split: ChannelSplit }) {
  const total = split.delivery.count + split.pickup.count;
  const deliveryPercent = total > 0 ? Math.round((split.delivery.count / total) * 100) : 0;

  return (
    <Card className="p-5">
      <h2 className="text-sm font-extrabold text-graphite">Como compraram hoje</h2>

      {total === 0 ? (
        <p className="mt-3 text-sm text-text-muted">Nenhum pedido hoje ainda.</p>
      ) : (
        <>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-subdued">
            <div className="h-full bg-primary" style={{ width: `${deliveryPercent}%` }} />
          </div>
          <div className="mt-3 space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-graphite">Delivery ({deliveryPercent}%)</span>
              <span className="text-text-muted">{split.delivery.count} pedidos</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium text-graphite">Retirada ({100 - deliveryPercent}%)</span>
              <span className="text-text-muted">{split.pickup.count} pedidos</span>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
