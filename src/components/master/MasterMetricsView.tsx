import Link from "next/link";
import { Card } from "@/components/ui/Card";
import {
  buildFunnelSteps,
  buildGrowthChart,
  computeMrrBreakdown,
} from "@/lib/masterDashboard";
import {
  METRIC_PERIODS,
  computeChurnRate,
  computeTicket,
  computeTrialConversion,
  computeVariation,
  formatDayLabel,
  ordersSeries,
  percentOf,
  type MasterMetrics,
  type MetricPeriod,
} from "@/lib/masterMetrics";
import { formatDateTimeBR } from "@/lib/masterRestaurants";
import { formatCurrencyBRL } from "@/lib/products";
import { LINE_CHART_SIZE, LineChart } from "./LineChart";
import { StatCard } from "./StatCard";

const PLAN_COLORS = ["bg-primary", "bg-amber", "bg-blue", "bg-emerald"];

function formatPercent(value: number): string {
  return `${(Math.round(value * 10) / 10).toLocaleString("pt-BR")}%`;
}

function formatInt(value: number): string {
  return value.toLocaleString("pt-BR");
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

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-surface-subdued p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-2 text-xl font-black text-graphite">{value}</p>
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

/** Métricas da plataforma (master). Todo número vem de master_metrics
 * (agregados reais, fuso de São Paulo). Onde não há base — percentual sobre
 * zero, ticket sem pedidos — a tela mostra "—", nunca 0% ou um valor
 * inventado. */
export function MasterMetricsView({ metrics, period }: { metrics: MasterMetrics; period: MetricPeriod }) {
  const newVariation = computeVariation(metrics.new_restaurants, metrics.new_restaurants_prev);
  const activationRate = percentOf(metrics.new_with_orders, metrics.new_restaurants);
  const trialConversion = computeTrialConversion(metrics.trial.converted, metrics.trial.expired_unsubscribed);
  const churn = computeChurnRate(metrics.cancellations, metrics.subscribers_active);
  const ticket = computeTicket(metrics.volume.gmv, metrics.volume.valid_orders);
  const operatingRate = percentOf(metrics.volume.operating_restaurants, metrics.restaurants_active);
  const mrr = computeMrrBreakdown(metrics.plans);
  const funnel = buildFunnelSteps(metrics.funnel);
  const chart = buildGrowthChart(ordersSeries(metrics.orders_by_day), LINE_CHART_SIZE, formatDayLabel);
  const labelStep = Math.max(1, Math.ceil(metrics.orders_by_day.length / 6));

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-graphite">Métricas da plataforma</h1>
          <p className="mt-0.5 text-sm font-medium text-text-muted">Crescimento, ativação, receita e retenção do MenuNext.</p>
        </div>
        <nav className="flex gap-1 rounded-xl bg-surface-subdued p-1" aria-label="Período">
          {METRIC_PERIODS.map((days) => (
            <Link
              key={days}
              href={days === 30 ? "/master/metricas" : `/master/metricas?dias=${days}`}
              aria-current={days === period ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                days === period ? "bg-surface-card text-graphite shadow-sm" : "text-text-muted hover:text-graphite"
              }`}
            >
              {days} dias
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard
          label="Receita recorrente (MRR)"
          value={formatCurrencyBRL(metrics.mrr)}
          hint={`${formatInt(metrics.subscribers_active)} ${plural(metrics.subscribers_active, "assinante em dia", "assinantes em dia")}`}
        />
        <StatCard
          label="Restaurantes ativos"
          value={formatInt(metrics.restaurants_active)}
          hint="Lojas publicadas na plataforma"
        />
        <StatCard
          label={`Novos restaurantes (${period} dias)`}
          value={formatInt(metrics.new_restaurants)}
          hint={
            newVariation === null
              ? `${formatInt(metrics.new_restaurants_prev)} no período anterior`
              : `${newVariation >= 0 ? "+" : "−"}${formatPercent(Math.abs(newVariation))} vs período anterior`
          }
        />
        <StatCard
          label="Taxa de ativação"
          value={activationRate === null ? "—" : formatPercent(activationRate)}
          hint={
            activationRate === null
              ? "Nenhum cadastro novo no período"
              : `${formatInt(metrics.new_with_orders)} de ${formatInt(metrics.new_restaurants)} novos já receberam pedido`
          }
        />
        <StatCard
          label="Conversão do trial"
          value={trialConversion === null ? "—" : formatPercent(trialConversion)}
          hint={
            trialConversion === null
              ? "Nenhum trial encerrado ainda"
              : `${formatInt(metrics.trial.converted)} assinaram · ${formatInt(metrics.trial.expired_unsubscribed)} expiraram sem assinar`
          }
        />
        <StatCard
          label="Churn"
          value={churn === null ? "—" : formatPercent(churn)}
          hint={`${formatInt(metrics.cancellations)} ${plural(metrics.cancellations, "cancelamento", "cancelamentos")} em ${period} dias`}
        />
      </div>

      <Card className="space-y-4 p-6">
        <SectionTitle
          title="Pedidos por dia"
          subtitle={`Volume de todos os restaurantes nos últimos ${period} dias (horário de Brasília).`}
        />
        <LineChart
          chart={chart}
          ariaLabel={`Pedidos por dia nos últimos ${period} dias`}
          tooltip={(dot) => `${dot.label}: ${dot.value} ${plural(dot.value, "pedido", "pedidos")}`}
          labelStep={labelStep}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4 p-6">
          <SectionTitle title="Volume operacional" subtitle="Pedidos feitos pelos clientes dos restaurantes." />
          <div className="grid grid-cols-2 gap-3">
            <MiniStat label="Pedidos" value={formatInt(metrics.volume.orders)} hint={`em ${period} dias`} />
            <MiniStat label="Valor transacionado" value={formatCurrencyBRL(metrics.volume.gmv)} hint="sem cancelados" />
            <MiniStat
              label="Ticket médio"
              value={ticket === null ? "—" : formatCurrencyBRL(ticket)}
              hint={ticket === null ? "Sem pedidos no período" : "por pedido"}
            />
            <MiniStat
              label="Lojas em operação"
              value={formatInt(metrics.volume.operating_restaurants)}
              hint={operatingRate === null ? "Sem restaurantes ativos" : `${formatPercent(operatingRate)} dos ativos`}
            />
          </div>
          <p className="rounded-xl bg-surface-subdued px-4 py-3 text-xs text-text-muted">
            Volume transacionado diretamente pelos restaurantes com seus clientes. Não é faturamento do MenuNext.
          </p>
        </Card>

        <Card className="space-y-4 p-6">
          <SectionTitle title="Balanço do período" subtitle={`O que aconteceu nos últimos ${period} dias.`} />
          <dl className="divide-y divide-border text-sm">
            <div className="flex justify-between py-3">
              <dt className="text-text-muted">Novos cadastros</dt>
              <dd className="font-bold text-graphite">{formatInt(metrics.new_restaurants)}</dd>
            </div>
            <div className="flex justify-between py-3">
              <dt className="text-text-muted">Primeiro pedido recebido</dt>
              <dd className="font-bold text-graphite">{formatInt(metrics.activated_in_period)}</dd>
            </div>
            <div className="flex justify-between py-3">
              <dt className="text-text-muted">Assinaturas canceladas</dt>
              <dd className="font-bold text-graphite">{formatInt(metrics.cancellations)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4 p-6">
          <SectionTitle
            title="Funil de ativação"
            subtitle={`Restaurantes cadastrados nos últimos ${period} dias, do cadastro ao primeiro pedido.`}
          />
          <ul className="space-y-3">
            {funnel.map((step) => (
              <li key={step.id}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-semibold text-graphite">{step.label}</span>
                  <span className="text-text-muted">
                    {formatInt(step.count)}
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
          <SectionTitle title="Trial de 30 dias" subtitle="Acompanhamento dos testes gratuitos." />
          <div className="grid grid-cols-2 gap-3">
            <MiniStat label="Iniciados" value={formatInt(metrics.trial.started)} hint={`em ${period} dias`} />
            <MiniStat label="Em andamento" value={formatInt(metrics.trial.active_now)} hint="hoje" />
            <MiniStat label="Assinaram" value={formatInt(metrics.trial.converted)} hint="após o teste" />
            <MiniStat label="Expiraram sem assinar" value={formatInt(metrics.trial.expired_unsubscribed)} hint="loja bloqueada" />
          </div>
          {metrics.trial.expiring_7d > 0 && (
            <p className="rounded-xl bg-[#FFFBEB] px-4 py-3 text-sm font-semibold text-[#B45309]">
              {metrics.trial.expiring_7d} {plural(metrics.trial.expiring_7d, "trial termina", "trials terminam")} nos próximos 7 dias.
            </p>
          )}
        </Card>
      </div>

      <Card className="space-y-4 p-6">
        <SectionTitle title="Distribuição por plano" subtitle="Assinantes em dia por plano e receita de cada um." />
        {mrr.rows.length === 0 ? (
          <p className="rounded-xl bg-surface-subdued p-4 text-sm text-text-muted">
            Nenhum plano cadastrado ainda.{" "}
            <Link href="/master/assinaturas" className="font-semibold text-primary hover:underline">
              Criar planos
            </Link>
          </p>
        ) : (
          <ul className="space-y-2">
            {mrr.rows.map((row, index) => (
              <li key={row.plan_id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-subdued px-4 py-3 text-sm">
                <span className="flex min-w-0 items-center gap-3">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${PLAN_COLORS[index % PLAN_COLORS.length]}`} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate font-bold text-graphite">{row.name}</span>
                    <span className="block text-xs text-text-muted">
                      {formatCurrencyBRL(row.price)}/mês · {row.subscribers} {plural(row.subscribers, "assinante", "assinantes")}
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
        )}
      </Card>

      <Card className="space-y-4 p-6">
        <SectionTitle title="Restaurantes em destaque" subtitle={`Maior volume de pedidos nos últimos ${period} dias.`} />
        {metrics.top_restaurants.length === 0 ? (
          <p className="rounded-xl bg-surface-subdued p-4 text-sm text-text-muted">Nenhum pedido no período.</p>
        ) : (
          <>
            <table className="hidden w-full text-left text-sm md:table">
              <thead className="border-b border-border text-xs font-bold uppercase tracking-wide text-text-muted">
                <tr>
                  <th className="py-2 pr-4">Restaurante</th>
                  <th className="px-4 py-2 text-right">Pedidos</th>
                  <th className="px-4 py-2 text-right">Valor transacionado</th>
                  <th className="px-4 py-2">Plano</th>
                  <th className="py-2 pl-4">Último pedido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {metrics.top_restaurants.map((row) => (
                  <tr key={row.id}>
                    <td className="py-3 pr-4">
                      <Link href={`/master/restaurantes/${row.id}`} className="font-bold text-graphite hover:text-primary">
                        {row.name}
                      </Link>
                      <p className="text-xs text-text-muted">/{row.slug}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-graphite">{formatInt(row.orders)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-graphite">{formatCurrencyBRL(row.gmv)}</td>
                    <td className="px-4 py-3 text-text-muted">{row.plan_name ?? "Sem plano"}</td>
                    <td className="py-3 pl-4 text-text-muted">{row.last_order_at ? formatDateTimeBR(row.last_order_at) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="space-y-2 md:hidden">
              {metrics.top_restaurants.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/master/restaurantes/${row.id}`}
                    className="block rounded-xl bg-surface-subdued px-4 py-3 text-sm"
                  >
                    <span className="block font-bold text-graphite">{row.name}</span>
                    <span className="block text-xs text-text-muted">
                      {formatInt(row.orders)} {plural(row.orders, "pedido", "pedidos")} · {formatCurrencyBRL(row.gmv)} · {row.plan_name ?? "Sem plano"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
