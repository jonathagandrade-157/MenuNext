import Link from "next/link";
import { Clock } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { MIN_ORDERS_FOR_PEAK, type PeakInsight } from "@/lib/insights";

const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}h`;

export function PeakCard({ peak }: { peak: PeakInsight | null }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Clock className="h-5 w-5 text-primary" aria-hidden />
        <h2 className="text-body-lg font-bold text-graphite">Horário de pico</h2>
      </div>

      {!peak ? (
        <p className="mt-3 text-body-md text-text-muted">
          Ainda há poucos pedidos para ver um padrão. Com {MIN_ORDERS_FOR_PEAK} pedidos no período, o horário de pico aparece aqui.
        </p>
      ) : (
        <>
          <p className="mt-3 text-body-md text-graphite">
            Seu pico é às <strong>{hourLabel(peak.peakHour.hour)}</strong>: {peak.peakHour.orders} de {peak.totalOrders} pedidos (
            {Math.round(peak.peakHour.sharePercent)}%). O dia mais forte é <strong>{peak.peakWeekday.weekday}</strong> (
            {peak.peakWeekday.orders} pedidos).
          </p>

          <div className="mt-4 flex h-24 items-end gap-1" role="img" aria-label="Pedidos por hora do dia">
            {peak.byHour.map((h) => {
              const max = peak.peakHour.orders || 1;
              return (
                <div key={h.hour} className="flex h-full flex-1 flex-col justify-end" title={`${hourLabel(h.hour)}: ${h.orders} pedidos`}>
                  <div
                    className={`w-full rounded-t ${h.hour === peak.peakHour.hour ? "bg-primary" : "bg-primary/25"}`}
                    style={{ height: `${Math.max((h.orders / max) * 100, h.orders > 0 ? 4 : 0)}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-label-sm text-text-muted">
            <span>0h</span>
            <span>12h</span>
            <span>23h</span>
          </div>

          <div className="mt-4 rounded-lg bg-surface-subdued p-3 text-body-md text-graphite">
            <p>
              <strong>O que fazer:</strong> garanta equipe e estoque antes das {hourLabel(peak.peakHour.hour)}.
              {peak.slowHour && (
                <>
                  {" "}
                  O horário mais fraco é {hourLabel(peak.slowHour.hour)} ({peak.slowHour.orders} pedidos): um{" "}
                  <Link href="/painel/marketing" className="font-semibold text-primary underline">
                    cupom para esse horário
                  </Link>{" "}
                  ajuda a distribuir a demanda.
                </>
              )}
            </p>
          </div>
        </>
      )}
    </Card>
  );
}
