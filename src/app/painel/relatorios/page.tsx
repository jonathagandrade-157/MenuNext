import { requireOwnerPage } from "@/lib/tenant";
import { computeSalesReport, getReportOrders, parseReportPeriod } from "@/lib/reports";
import { formatCurrencyBRL } from "@/lib/store";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/States";

const INPUT = "h-10 rounded-xl border border-border bg-surface px-3 text-body-md text-graphite focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";
const PAYMENT_LABELS = { pix: "Pix", cash: "Dinheiro", card: "Cartão" } as const;
const FULFILLMENT_LABELS = { delivery: "Entrega", pickup: "Retirada", counter: "Balcão" } as const;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-label-md text-text-muted">{label}</p>
      <p className="mt-1 text-headline-md text-graphite">{value}</p>
      {hint && <p className="mt-0.5 text-body-sm text-text-muted">{hint}</p>}
    </Card>
  );
}

const dayLabel = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");

// Relatórios financeiros: restrito ao OWNER (mesmo critério de Insights).
export default async function RelatoriosPage(props: PageProps<"/painel/relatorios">) {
  const { supabase, restaurant } = await requireOwnerPage();
  const params = await props.searchParams;
  const parsed = parseReportPeriod(params.from, params.to);
  const fallback = parseReportPeriod(undefined, undefined);
  const period = parsed.ok ? parsed.period : fallback.ok ? fallback.period : null;
  if (!period) return <ErrorState message="Não foi possível calcular o período." />;

  const { rows, truncated } = await getReportOrders(supabase, restaurant.id, period);
  const report = computeSalesReport(rows);
  const maxDay = Math.max(1, ...report.daily.map((d) => d.revenue));
  const exportHref = `/painel/relatorios/exportar?from=${period.from}&to=${period.to}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-headline-lg text-graphite">Relatórios</h1>
        <p className="mt-0.5 text-body-md text-text-muted">Vendas, produtos mais vendidos e histórico de pedidos por período.</p>
      </div>

      <Card className="p-4">
        <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block space-y-1">
            <span className="text-label-md text-graphite">De</span>
            <input type="date" name="from" defaultValue={period.from} max={period.to} className={`${INPUT} w-full`} />
          </label>
          <label className="block space-y-1">
            <span className="text-label-md text-graphite">Até</span>
            <input type="date" name="to" defaultValue={period.to} className={`${INPUT} w-full`} />
          </label>
          <button type="submit" className="h-10 rounded-xl bg-primary px-5 text-label-lg text-white">Aplicar</button>
          <a href={exportHref} className="inline-flex h-10 items-center justify-center rounded-xl border border-border px-5 text-label-lg text-graphite hover:bg-surface-subdued">
            Exportar CSV
          </a>
        </form>
        {!parsed.ok && <div className="mt-3"><ErrorState message={`${parsed.error} Mostrando os últimos 30 dias.`} /></div>}
      </Card>

      {truncated && <ErrorState message="O período tem mais de 10.000 pedidos; os números mostram só os primeiros. Reduza o período." />}

      <p className="text-body-sm text-text-muted">
        Venda = pedido não cancelado. Faturamento = soma dos totais (com frete, já descontados cupons e promoções). O sistema não
        confirma o recebimento do Pix: o valor é o vendido, não o conciliado no banco. Horário de Brasília.
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Faturamento" value={formatCurrencyBRL(report.revenue)} />
        <Stat label="Pedidos" value={String(report.orders)} hint={`${report.cancelled} cancelado(s)`} />
        <Stat label="Ticket médio" value={formatCurrencyBRL(report.averageTicket)} />
        <Stat label="Descontos concedidos" value={formatCurrencyBRL(report.discounts)} hint={`Taxas de entrega: ${formatCurrencyBRL(report.deliveryFees)}`} />
      </div>

      {report.orders === 0 ? (
        <Card className="p-8 text-center text-body-md text-text-muted">Nenhum pedido neste período.</Card>
      ) : (
        <>
          <section className="space-y-3" aria-labelledby="vendas-dia">
            <h2 id="vendas-dia" className="text-headline-sm text-graphite">Vendas por dia</h2>
            <Card className="space-y-2 p-4">
              {report.daily.map((d) => (
                <div key={d.date} className="flex items-center gap-3 text-body-sm">
                  <span className="w-12 shrink-0 text-text-muted">{dayLabel(d.date)}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-subdued">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, (d.revenue / maxDay) * 100)}%` }} />
                  </div>
                  <span className="w-28 shrink-0 text-right text-graphite">{formatCurrencyBRL(d.revenue)}</span>
                  <span className="hidden w-16 shrink-0 text-right text-text-muted sm:block">{d.orders} ped.</span>
                </div>
              ))}
            </Card>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-3" aria-labelledby="top-produtos">
              <h2 id="top-produtos" className="text-headline-sm text-graphite">Produtos mais vendidos</h2>
              <Card className="overflow-hidden p-0">
                <ul className="divide-y divide-border">
                  {report.topProducts.map((p, i) => (
                    <li key={p.name} className="flex items-center justify-between gap-3 px-4 py-3">
                      <span className="min-w-0 truncate text-body-md text-graphite">{i + 1}. {p.name}</span>
                      <span className="shrink-0 text-body-sm text-text-muted">{p.quantity} un. · {formatCurrencyBRL(p.revenue)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>

            <section className="space-y-3" aria-labelledby="formas">
              <h2 id="formas" className="text-headline-sm text-graphite">Pagamento e tipo de pedido</h2>
              <Card className="divide-y divide-border p-0">
                {(Object.keys(PAYMENT_LABELS) as (keyof typeof PAYMENT_LABELS)[]).map((k) => (
                  <div key={k} className="flex justify-between px-4 py-3 text-body-md">
                    <span className="text-graphite">{PAYMENT_LABELS[k]}</span>
                    <span className="text-text-muted">{report.byPayment[k].orders} ped. · {formatCurrencyBRL(report.byPayment[k].revenue)}</span>
                  </div>
                ))}
                {(Object.keys(FULFILLMENT_LABELS) as (keyof typeof FULFILLMENT_LABELS)[]).map((k) => (
                  <div key={k} className="flex justify-between px-4 py-3 text-body-md">
                    <span className="text-graphite">{FULFILLMENT_LABELS[k]}</span>
                    <span className="text-text-muted">{report.byFulfillment[k].orders} ped. · {formatCurrencyBRL(report.byFulfillment[k].revenue)}</span>
                  </div>
                ))}
              </Card>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
