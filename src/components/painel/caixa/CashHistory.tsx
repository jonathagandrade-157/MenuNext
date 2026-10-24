import { describeCashDifference, formatCashDateTime, type CashDifference, type CashHistoryRow } from "@/lib/cash";
import { formatCurrencyBRL } from "@/lib/store";

const BADGE: Record<CashDifference["kind"], string> = {
  ok: "bg-emerald/10 text-emerald",
  over: "bg-amber/15 text-amber-strong",
  short: "bg-red/10 text-red",
};

/** Histórico de turnos de caixa. Só o OWNER recebe linhas da RPC; para os demais a página nem monta isto. */
export function CashHistory({ rows }: { rows: CashHistoryRow[] }) {
  if (rows.length === 0) return null;

  return (
    <section aria-labelledby="cash-history-title" className="space-y-3">
      <h2 id="cash-history-title" className="text-headline-sm text-graphite">
        Histórico do caixa
      </h2>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface-card">
        {rows.map((row) => {
          const diff = row.difference !== null ? describeCashDifference(row.difference) : null;
          return (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0">
                <p className="text-label-lg font-bold text-graphite">
                  {formatCashDateTime(row.openedAt)}
                  {row.closedAt ? ` → ${formatCashDateTime(row.closedAt)}` : ""}
                </p>
                <p className="text-body-sm text-text-muted">
                  {row.closedAt ? `Aberto por ${row.openedByName}, fechado por ${row.closedByName ?? "—"}` : `Aberto por ${row.openedByName} · em andamento`}
                  {" · "}
                  {row.ordersCount} {row.ordersCount === 1 ? "venda" : "vendas"} · {formatCurrencyBRL(row.totalSales)}
                </p>
                {row.notes && <p className="mt-0.5 truncate text-body-sm text-text-muted">“{row.notes}”</p>}
              </div>
              <div className="flex shrink-0 items-center gap-3 text-right">
                {row.countedCash !== null && row.expectedCash !== null && (
                  <p className="text-body-sm text-text-muted">
                    Contado {formatCurrencyBRL(row.countedCash)}
                    <br />
                    Esperado {formatCurrencyBRL(row.expectedCash)}
                  </p>
                )}
                {diff ? (
                  <span className={`rounded-full px-2.5 py-1 text-label-md font-bold ${BADGE[diff.kind]}`}>{diff.label}</span>
                ) : (
                  <span className="rounded-full bg-surface-subdued px-2.5 py-1 text-label-md font-bold text-text-muted">Aberto</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
