import { Card } from "@/components/ui/Card";
import type { DashboardInsight } from "@/lib/dashboard";

export function InsightsRow({ insights }: { insights: DashboardInsight[] }) {
  if (insights.length === 0) return null;

  return (
    <div>
      <h2 className="mb-2 text-sm font-extrabold text-graphite">Hoje no seu restaurante</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {insights.map((insight) => (
          <Card key={insight.label} className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-primary">{insight.label}</p>
            <p className="mt-1 text-sm font-semibold text-graphite">{insight.value}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
