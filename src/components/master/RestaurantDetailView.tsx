import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatCurrencyBRL } from "@/lib/products";
import { StatCard } from "./StatCard";
import {
  RESTAURANT_STATUS_BADGE,
  SUBSCRIPTION_STATUS_BADGE,
  buildActivationSteps,
  computeActivationProgress,
  computeCompletionRate,
  computeMrr,
  formatDateBR,
  formatDateTimeBR,
  formatTimeBR,
  type MasterRestaurantDetail,
} from "@/lib/masterRestaurants";

function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="py-2.5 text-sm">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-0.5 [overflow-wrap:anywhere] font-semibold text-graphite">{value ?? "—"}</dd>
    </div>
  );
}

function ProgressBar({ percent, tone }: { percent: number; tone: "primary" | "success" }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-subdued" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${tone === "success" ? "bg-emerald" : "bg-primary"}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Detalhe de um restaurante, visão do Master. Todo número vem da RPC
 * master_get_restaurant; nada aqui é estimado ou de exemplo. */
export function RestaurantDetailView({ detail }: { detail: MasterRestaurantDetail }) {
  const status = RESTAURANT_STATUS_BADGE[detail.status];
  const subscription = SUBSCRIPTION_STATUS_BADGE[detail.subscription_status];
  const mrr = computeMrr(detail.plan_price, detail.subscription_status);
  const completionRate = computeCompletionRate(detail.orders_completed, detail.orders_cancelled);
  const steps = buildActivationSteps(detail);
  const progress = computeActivationProgress(steps);
  const storeHref = `/loja/${detail.slug}`;
  const hasPublicStore = detail.onboarding_completed;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <Link href="/master/restaurantes" className="text-sm font-semibold text-text-muted hover:text-graphite">
          ← Voltar para todos os restaurantes
        </Link>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-graphite">{detail.name}</h1>
            <p className="mt-0.5 text-sm font-medium text-text-muted">/{detail.slug}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={status.tone}>{status.label}</Badge>
              <Badge tone={subscription.tone}>{subscription.label}</Badge>
              <Badge tone="neutral">Desde {formatDateBR(detail.created_at)}</Badge>
            </div>
          </div>
          {hasPublicStore && (
            <a
              href={storeHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-card px-5 text-sm font-semibold text-graphite transition-colors hover:border-slate-300 hover:bg-surface"
            >
              Abrir loja pública
            </a>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Pedidos"
          value={detail.orders_total.toLocaleString("pt-BR")}
          hint={`${detail.orders_month.toLocaleString("pt-BR")} neste mês`}
        />
        <StatCard
          label="Receita recorrente"
          value={`${formatCurrencyBRL(mrr)}/mês`}
          hint={detail.plan_name ? `Plano ${detail.plan_name}` : "Sem plano assinado"}
        />
        <StatCard
          label="Clientes"
          value={detail.customers_unique.toLocaleString("pt-BR")}
          hint="Telefones distintos que já pediram"
        />
        <StatCard
          label="Último pedido"
          value={detail.last_order_at ? formatDateBR(detail.last_order_at) : "—"}
          hint={detail.last_order_at ? `às ${formatTimeBR(detail.last_order_at)}` : "Nenhum pedido ainda"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="space-y-4 p-6">
            <div>
              <h2 className="text-sm font-extrabold uppercase tracking-wide text-text-muted">Assinatura</h2>
              <p className="mt-1 text-sm text-text-muted">Situação do plano do MenuNext. A cobrança é feita pelo Asaas.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-surface-subdued p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Situação</p>
                <div className="mt-2">
                  <Badge tone={subscription.tone}>{subscription.label}</Badge>
                </div>
              </div>
              <div className="rounded-xl bg-surface-subdued p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Plano</p>
                <p className="mt-2 text-sm font-bold text-graphite">{detail.plan_name ?? "Nenhum plano assinado"}</p>
              </div>
              <div className="rounded-xl bg-surface-subdued p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Valor do plano</p>
                <p className="mt-2 text-sm font-bold text-graphite">
                  {detail.plan_price !== null ? `${formatCurrencyBRL(detail.plan_price)}/mês` : "—"}
                </p>
              </div>
            </div>
          </Card>

          <Card className="space-y-4 p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-extrabold uppercase tracking-wide text-text-muted">Progresso de ativação</h2>
                <p className="mt-1 text-sm text-text-muted">Etapas verificadas nos dados reais do restaurante.</p>
              </div>
              <Badge tone={progress.percent === 100 ? "success" : "warning"}>{progress.percent}% ativado</Badge>
            </div>
            <ProgressBar percent={progress.percent} tone={progress.percent === 100 ? "success" : "primary"} />
            <ul className="space-y-2">
              {steps.map((step) => (
                <li
                  key={step.id}
                  className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm ${
                    step.done ? "bg-[#ECFDF5] text-[#047857]" : "bg-surface-subdued text-text-muted"
                  }`}
                >
                  <span className="flex items-center gap-3 font-semibold">
                    <span aria-hidden="true">{step.done ? "✓" : "○"}</span>
                    <span>
                      {step.label}
                      <span className="sr-only">{step.done ? " — concluída" : " — pendente"}</span>
                    </span>
                  </span>
                  {step.date && <span className="shrink-0 text-xs">{formatDateBR(step.date)}</span>}
                </li>
              ))}
            </ul>
          </Card>

          <Card className="space-y-4 p-6">
            <div>
              <h2 className="text-sm font-extrabold uppercase tracking-wide text-text-muted">Volume de pedidos</h2>
              <p className="mt-1 text-sm text-text-muted">Contagens consolidadas, sem dados operacionais dos clientes.</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-surface-subdued p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Hoje</p>
                <p className="mt-2 text-xl font-black text-graphite">{detail.orders_today.toLocaleString("pt-BR")}</p>
              </div>
              <div className="rounded-xl bg-surface-subdued p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Este mês</p>
                <p className="mt-2 text-xl font-black text-graphite">{detail.orders_month.toLocaleString("pt-BR")}</p>
              </div>
              <div className="rounded-xl bg-surface-subdued p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Total</p>
                <p className="mt-2 text-xl font-black text-graphite">{detail.orders_total.toLocaleString("pt-BR")}</p>
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-semibold text-graphite">Taxa de conclusão</span>
                <span className="font-bold text-graphite">{completionRate !== null ? `${completionRate.toLocaleString("pt-BR")}%` : "—"}</span>
              </div>
              <ProgressBar percent={completionRate ?? 0} tone="success" />
              <p className="mt-2 text-xs text-text-muted">
                {completionRate !== null
                  ? `${detail.orders_completed.toLocaleString("pt-BR")} entregues ou retirados · ${detail.orders_cancelled.toLocaleString("pt-BR")} cancelados`
                  : "Ainda não há pedidos encerrados para calcular a taxa."}
              </p>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-text-muted">Informações cadastrais</h2>
            <dl className="mt-2 divide-y divide-border">
              <InfoRow label="Nome comercial" value={detail.name} />
              <InfoRow label="Endereço da loja" value={`/loja/${detail.slug}`} />
              <InfoRow label="Responsável" value={detail.owner_name} />
              <InfoRow label="E-mail do titular" value={detail.owner_email} />
              <InfoRow label="E-mail de contato" value={detail.contact_email} />
              <InfoRow label="WhatsApp" value={detail.contact_whatsapp} />
              <InfoRow label="Cadastro em" value={formatDateTimeBR(detail.created_at)} />
              <InfoRow label="ID" value={detail.id} />
            </dl>
          </Card>

          <Card className="space-y-3 p-6">
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-text-muted">Cardápio e horários</h2>
            <dl className="divide-y divide-border">
              <InfoRow label="Produtos cadastrados" value={detail.products_count.toLocaleString("pt-BR")} />
              <InfoRow label="Dias com horário definido" value={`${detail.open_business_days} de 7`} />
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
