import { Card } from "@/components/ui/Card";
import { formatCurrencyBRL } from "@/lib/orders";
import type { DeliveryToday } from "@/lib/dashboard";

export function DeliveryTodayCard({ delivery }: { delivery: DeliveryToday }) {
  return (
    <Card className="p-5">
      <h2 className="text-sm font-extrabold text-graphite">Delivery hoje</h2>
      <p className="mt-2 text-2xl font-black text-graphite">
        {delivery.count} <span className="text-base font-semibold text-text-muted">pedidos</span>
      </p>
      <p className="mt-1 text-sm text-text-muted">{formatCurrencyBRL(delivery.revenue)} em faturamento</p>
      <p className="mt-2 text-xs text-text-muted">
        Tempo médio de entrega:{" "}
        {delivery.averageMinutes !== null ? `${Math.round(delivery.averageMinutes)} min` : "sem pedidos entregues hoje"}
      </p>
    </Card>
  );
}
