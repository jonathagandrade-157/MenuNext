import { Card } from "@/components/ui/Card";
import type { CustomersToday } from "@/lib/dashboard";

export function CustomersTodayCard({ customers }: { customers: CustomersToday }) {
  return (
    <Card className="p-5">
      <h2 className="text-body-lg font-bold text-graphite">Seus clientes hoje</h2>
      <p className="mt-2 text-headline-lg text-graphite">
        {customers.attended} <span className="text-base font-semibold text-text-muted">atendidos</span>
      </p>
      <p className="mt-1 text-sm text-text-muted">
        {customers.new} novo{customers.new === 1 ? "" : "s"} • {customers.returning} recorrente
        {customers.returning === 1 ? "" : "s"}
      </p>
    </Card>
  );
}
