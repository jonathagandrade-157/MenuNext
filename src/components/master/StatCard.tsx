import { Card } from "@/components/ui/Card";

export function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-2 text-2xl font-black text-graphite">{value}</p>
      <p className="mt-1 text-xs text-text-muted">{hint}</p>
    </Card>
  );
}
