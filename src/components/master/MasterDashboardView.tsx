import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { computeYesterdayComparison } from "@/lib/dashboard";
import {
  buildFunnelSteps,
  buildGrowthChart,
  computeAverageTicket,
  computeMrrBreakdown,
  type MasterDashboardStats,
} from "@/lib/masterDashboard";
import type { MasterRestaurantRow } from "@/lib/masterRestaurants";
import { formatCurrencyBRL } from "@/lib/products";
import { LINE_CHART_SIZE, LineChart } from "./LineChart";
import { StatCard } from "./StatCard";

const PLAN_COLORS = ["bg-primary", "bg-amber", "bg-blue", "bg-emerald"];

function formatPercent(value: number): string {
  return `${(Math.round(value * 10) / 10).toLocaleString("pt-BR")}%`;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-text-muted">{title}</h2>
      <p className="mt-1 text-sm text-text-muted">{subtitle}</p>
    </div>
  );
}

function GrowthChart({ stats }: { stats: MasterDashboardStats }) {
  return (
    <LineChart
      chart={buildGrowthChart(stats.growth, LINE_CHART_SIZE)}
      ariaLabel="Restaurantes cadastrados por mês"
      tooltip={(dot) => `${dot.label}: ${dot.value} cadastrados no total`}
    />
  );
}

/** Dashboard Master: visão geral da plataforma. Todo número vem de
 * master_dashboard_stats (agregados reais); onde o dado não existe (ex.:
 * variação mensal de MRR, sem histórico de assinaturas) a tela não inventa. */
export function MasterDashboardView({
  stats,
  overdue,
  overdueTotal,
}: {
  stats: MasterDashboardStats;
  overdue: MasterRestaurantRow[];
  overdueTotal: number;
}) {
  const averageTicket = computeAverageTicket(stats.mrr, stats.subscribers_active);
  const mrr = computeMrrBreakdown(stats.plans);
  const funnel = buildFunnelSteps(stats.funnel);
  const ordersVariation = computeYesterdayComparison(stats.orders_today, stats.orders_yesterday);

  const subscriptionIssues = [
    stats.subscribers_pending > 0 ? `${stats.subscribers_pending} aguardando 1º pagamento` : null,
    stats.subscribers_overdue > 0
      ? `${stats.subscribers_overdue} ${plural(stats.subscribers_overdue, "atrasada", "atrasadas")}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const subscriptionHint =
    subscriptionIssues || (stats.subscribers_active === 0 ? "Nenhuma assinatura ainda" : "Todas em dia");

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-graphite">Visão geral</h1>
        <p className="mt-0.5 text-sm font-medium text-text-muted">Acompanhe a operação e o crescimento do MenuNext em nível global.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Restaurantes ativos"
          value={stats.restaurants_active.toLocaleString("pt-BR")}
          hint={`${stats.restaurants_new_month.toLocaleString("pt-BR")} ${plural(stats.restaurants_new_month, "novo", "novos")} neste mês · ${stats.restaurants_total.toLocaleString("pt-BR")} ${plural(stats.restaurants_total, "cadastrado", "cadastrados")}`}
        />
        <StatCard
          label="Trials em andamento"
          value={stats.trials_active.toLocaleString("pt-BR")}
          hint={
            stats.trials_expiring_7d > 0
              ? `${stats.trials_expiring_7d} ${plural(stats.trials_expiring_7d, "vence", "vencem")} em 7 dias`
              : "Nenhum vence em 7 dias"
          }
        />
        <StatCard
          label="Assinaturas ativas"
          value={stats.subscribers_active.toLocaleString("pt-BR")}
          hint={subscriptionHint || "Todas em dia"}
        />
        <StatCard
          label="Receita recorrente (MRR)"
          value={formatCurrencyBRL(stats.mrr)}
          hint={averageTicket === null ? "Sem assinantes em dia" : `Ticket médio ${formatCurrencyBRL(averageTicket)} por assinante`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4 p-6">
          <SectionTitle title="Crescimento de restaurantes" subtitle="Restaurantes cadastrados acumulados, nos últimos 12 meses." />
          <GrowthChart stats={stats} />
        </Card>

        <Card className="space-y-4 p-6">
          <SectionTitle title="Receita recorrente por plano" subtitle="Assinaturas em dia, agrupadas por plano." />
          {mrr.rows.length === 0 ? (
            <p className="rounded-xl bg-surface-subdued p-4 text-sm text-text-muted">
              Nenhum plano cadastrado ainda.{" "}
              <Link href="/master/assinaturas" className="font-semibold text-primary hover:underline">
                Criar planos
              </Link>
            </p>
          ) : (
            <>
              <p className="text-2xl font-black text-graphite">{formatCurrencyBRL(mrr.total)}</p>
              {mrr.total > 0 && (
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-subdued">
                  {mrr.rows.map((row, index) =>
                    row.revenue > 0 ? (
                      <div key={row.plan_id} className={PLAN_COLORS[index % PLAN_COLORS.length]} style={{ width: `${row.share}%` }} />
                    ) : null
                  )}
                </div>
              )}
              <ul className="space-y-2">
                {mrr.rows.map((row, index) => (
                  <li key={row.plan_id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-subdued px-4 py-3 text-sm">
                    <span className="flex min-w-0 items-center gap-3">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${PLAN_COLORS[index % PLAN_COLORS.length]}`} aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block truncate font-bold text-graphite">{row.name}</span>
                        <span className="block text-xs text-text-muted">
                          {formatCurrencyBRL(row.price)}/mês · {row.subscribers} {row.subscribers === 1 ? "assinante" : "assinantes"}
                        </span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-bold text-graphite">{formatCurrencyBRL(row.revenue)}</span>
                      <span className="block text-xs text-text-muted">{row.share === null ? "—" : `${formatPercent(row.share)} da receita`}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="space-y-4 p-6">
          <SectionTitle title="Funil de ativação" subtitle="Do cadastro ao primeiro pedido." />
          <ul className="space-y-3">
            {funnel.map((step) => (
              <li key={step.id}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-semibold text-graphite">{step.label}</span>
                  <span className="text-text-muted">
                    {step.count.toLocaleString("pt-BR")}
                    {step.percent !== null && ` · ${formatPercent(step.percent)}`}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface-subdued">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${step.percent ?? 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="space-y-4 p-6">
          <SectionTitle title="Pedidos na plataforma" subtitle="Volume de todos os restaurantes." />
          <div>
            <p className="text-3xl font-black text-graphite">{stats.orders_today.toLocaleString("pt-BR")}</p>
            <p className="mt-1 text-xs text-text-muted">
              pedidos hoje ·{" "}
              {ordersVariation === null
                ? "ontem sem pedidos"
                : `${ordersVariation >= 0 ? "+" : "−"}${formatPercent(Math.abs(ordersVariation))} vs ontem`}
            </p>
          </div>
          <dl className="divide-y divide-border text-sm">
            <div className="flex justify-between py-2.5">
              <dt className="text-text-muted">Neste mês</dt>
              <dd className="font-semibold text-graphite">{stats.orders_month.toLocaleString("pt-BR")}</dd>
            </div>
            <div className="flex justify-between py-2.5">
              <dt className="text-text-muted">Total</dt>
              <dd className="font-semibold text-graphite">{stats.orders_total.toLocaleString("pt-BR")}</dd>
            </div>
          </dl>
        </Card>

        <Card className="space-y-4 p-6">
          <SectionTitle title="Assinaturas atrasadas" subtitle="Lojas com pagamento em atraso (acesso bloqueado)." />
          {overdue.length === 0 ? (
            <p className="rounded-xl bg-[#ECFDF5] p-4 text-sm font-semibold text-[#047857]">Nenhuma assinatura atrasada.</p>
          ) : (
            <>
              <ul className="space-y-2">
                {overdue.map((row) => (
                  <li key={row.id}>
                    <Link
                      href={`/master/restaurantes/${row.id}`}
                      className="flex items-center justify-between gap-3 rounded-xl bg-surface-subdued px-4 py-3 text-sm hover:bg-surface-subdued/70"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-bold text-graphite">{row.name}</span>
                        <span className="block text-xs text-text-muted">
                          {row.plan_name ?? "Sem plano"}
                          {row.plan_price !== null && ` · ${formatCurrencyBRL(row.plan_price)}/mês`}
                        </span>
                      </span>
                      <Badge tone="danger">Atrasada</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
              {overdueTotal > overdue.length && (
                <Link href="/master/restaurantes?status=overdue" className="block text-sm font-semibold text-primary hover:underline">
                  Ver todas ({overdueTotal}) →
                </Link>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
