import { Card } from "@/components/ui/Card";
import type { ChannelSplit } from "@/lib/dashboard";

const LABELS: Record<keyof ChannelSplit, string> = { delivery: "Delivery", pickup: "Retirada", counter: "Balcão" };

export function ChannelSplitCard({ split }: { split: ChannelSplit }) {
  const total = split.delivery.count + split.pickup.count + split.counter.count;

  return (
    <Card className="p-5">
      <h2 className="text-sm font-extrabold text-graphite">Como compraram hoje</h2>

      {total === 0 ? (
        <p className="mt-3 text-sm text-text-muted">Nenhum pedido hoje ainda.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {(Object.keys(LABELS) as (keyof ChannelSplit)[]).map((channel) => {
            const percent = Math.round((split[channel].count / total) * 100);
            return (
              <div key={channel}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-graphite">{LABELS[channel]}</span>
                  <span className="text-text-muted">
                    {split[channel].count} pedidos ({percent}%)
                  </span>
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
