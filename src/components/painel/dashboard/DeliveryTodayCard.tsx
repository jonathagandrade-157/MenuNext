import { Card } from "@/components/ui/Card";
import { formatCurrencyBRL } from "@/lib/orders";
import type { DeliveryToday } from "@/lib/dashboard";

export function DeliveryTodayCard({ delivery }: { delivery: DeliveryToday }) {
  return (
    <Card className="p-5">
      <h2 className="text-body-lg font-bold text-graphite">Delivery hoje</h2>
      <p className="mt-2 text-headline-lg text-graphite">
        {delivery.count} <span className="text-body-lg font-semibold text-text-muted">pedidos</span>
      </p>
      <p className="mt-1 text-body-md text-text-muted">{formatCurrencyBRL(delivery.revenue)} em faturamento</p>
      <p className="mt-2 text-body-sm text-text-muted">
        Tempo médio de entrega:{" "}
        {delivery.averageMinutes !== null ? `${Math.round(delivery.averageMinutes)} min` : "sem pedidos entregues hoje"}
      </p>
    </Card>
  );
}
