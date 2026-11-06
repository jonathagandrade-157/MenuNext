import Link from "next/link";
import { requireOwnerPage } from "@/lib/tenant";
import { parseReportPeriod } from "@/lib/reports";
import { computeStockReport, getStockReportData } from "@/lib/stockReport";
import { isMissingRpc } from "@/lib/rpcErrors";
import { STOCK_STATUS_LABELS } from "@/lib/stock";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/States";

const INPUT = "h-10 rounded-xl border border-border bg-surface px-3 text-body-md text-graphite focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

export default async function RelatorioEstoquePage(props: PageProps<"/painel/estoque/relatorio">) {
  const { supabase, restaurant } = await requireOwnerPage();
  const params = await props.searchParams;
  const parsed = parseReportPeriod(params.from, params.to);
  const fallback = parseReportPeriod(undefined, undefined);
  const period = parsed.ok ? parsed.period : fallback.ok ? fallback.period : null;
  if (!period) return <ErrorState message="Não foi possível calcular o período." />;

  let data;
  try {
    data = await getStockReportData(supabase, restaurant.id, period);
  } catch (error) {
    if (isMissingRpc(error as { code?: string; message?: string })) {
      return <div className="mx-auto max-w-3xl px-4 py-8"><EmptyState title="Estoque indisponível neste ambiente." description="A migration de estoque ainda não foi aplicada." /></div>;
    }
    throw error;
  }
  const report = computeStockReport(data.products, data.ledger, period.startIso, period.endIso, data.thresholds);
  const exportHref = `/painel/estoque/exportar?from=${period.from}&to=${period.to}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-headline-lg text-graphite">Relatório de estoque</h1>
          <p className="mt-0.5 text-body-md text-text-muted">Entradas, saídas, vendas e saldo por produto no período.</p>
        </div>
        <Link href="/painel/estoque" className="text-label-lg text-primary hover:underline">Voltar ao estoque</Link>
      </div>

      <Card className="p-4">
        <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block space-y-1"><span className="text-label-md text-graphite">De</span><input type="date" name="from" defaultValue={period.from} max={period.to} className={`${INPUT} w-full`} /></label>
          <label className="block space-y-1"><span className="text-label-md text-graphite">Até</span><input type="date" name="to" defaultValue={period.to} className={`${INPUT} w-full`} /></label>
          <button type="submit" className="h-10 rounded-xl bg-primary px-5 text-label-lg text-white">Aplicar</button>
          <a href={exportHref} className="inline-flex h-10 items-center justify-center rounded-xl border border-border px-5 text-label-lg text-graphite hover:bg-surface-subdued">Exportar CSV</a>
        </form>
        {!parsed.ok && <div className="mt-3"><ErrorState message={`${parsed.error} Mostrando os últimos 30 dias.`} /></div>}
      </Card>
      {data.truncated && <ErrorState message="O livro tem mais de 10.000 movimentações; os números podem estar incompletos." />}

      <p className="text-body-sm text-text-muted">
        Venda líquida = vendas menos estornos de pedidos cancelados (só existem com a baixa automática ligada). Saldo inicial e final vêm
        do livro de movimentações. Horário de Brasília.
      </p>

      {report.rows.length === 0 ? (
        <EmptyState title="Nenhuma movimentação até o fim do período." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[44rem] text-left text-body-md">
            <thead className="border-b border-border bg-surface-subdued/70 text-label-sm uppercase text-text-muted">
              <tr>{["Produto", "Inicial", "Entradas", "Saídas", "Perdas", "Venda líq.", "Ajustes", "Final", "Situação"].map((h) => <th key={h} className="px-3 py-2.5 first:pl-4">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.rows.map((r) => (
                <tr key={r.productId}>
                  <td className="max-w-[14rem] truncate px-3 py-2.5 pl-4 font-medium text-graphite">{r.name}</td>
                  <td className="px-3 py-2.5">{r.opening}</td><td className="px-3 py-2.5">{r.entries}</td><td className="px-3 py-2.5">{r.exits}</td>
                  <td className="px-3 py-2.5">{r.losses}</td><td className="px-3 py-2.5">{r.netSold}</td>
                  <td className="px-3 py-2.5">{r.adjustments > 0 ? `+${r.adjustments}` : r.adjustments}</td>
                  <td className="px-3 py-2.5 font-semibold text-graphite">{r.closing}</td>
                  <td className="px-3 py-2.5 text-text-muted">{r.status ? STOCK_STATUS_LABELS[r.status] : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
