import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/States";
import { formatCurrencyBRL } from "@/lib/products";
import {
  LIST_PAGE_SIZE,
  RESTAURANT_STATUS_BADGE,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_BADGE,
  buildListHref,
  subscriptionBadge,
  formatDateBR,
  formatDateTimeBR,
  type MasterListParams,
  type MasterRestaurantRow,
} from "@/lib/masterRestaurants";

const inputClass =
  "h-11 w-full rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

function PlanCell({ row }: { row: MasterRestaurantRow }) {
  if (!row.plan_name) return <span className="text-text-muted">Sem plano</span>;
  return (
    <span>
      <span className="font-semibold text-graphite">{row.plan_name}</span>
      {row.plan_price !== null && <span className="text-text-muted"> · {formatCurrencyBRL(row.plan_price)}/mês</span>}
    </span>
  );
}

function RestaurantBadges({ row }: { row: MasterRestaurantRow }) {
  const status = RESTAURANT_STATUS_BADGE[row.status];
  const subscription = subscriptionBadge(row.subscription_status, row.access_state);
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge tone={status.tone}>{status.label}</Badge>
      <Badge tone={subscription.tone}>{subscription.label}</Badge>
    </div>
  );
}

/** Lista de restaurantes do Master: busca por nome/slug, filtro por situação
 * da assinatura e paginação. Filtros são um formulário GET comum — a URL é a
 * fonte da verdade, sem estado de cliente. */
export function RestaurantsListView({
  rows,
  total,
  params,
}: {
  rows: MasterRestaurantRow[];
  total: number;
  params: MasterListParams;
}) {
  const totalPages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
  const hasFilters = params.search !== null || params.subscriptionStatus !== null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-graphite">Restaurantes</h1>
        <p className="mt-0.5 text-sm font-medium text-text-muted">
          {total === 1 ? "1 restaurante" : `${total} restaurantes`}
          {hasFilters ? " encontrados com os filtros atuais." : " cadastrados na plataforma."}
        </p>
      </div>

      <Card className="p-4">
        <form method="get" action="/master/restaurantes" className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            name="q"
            type="search"
            defaultValue={params.search ?? ""}
            placeholder="Buscar por nome ou endereço da loja"
            maxLength={80}
            aria-label="Buscar restaurante"
            className={inputClass}
          />
          <select
            name="status"
            defaultValue={params.subscriptionStatus ?? ""}
            aria-label="Filtrar por assinatura"
            className={`${inputClass} sm:max-w-[16rem]`}
          >
            <option value="">Todas as assinaturas</option>
            {SUBSCRIPTION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {SUBSCRIPTION_STATUS_BADGE[status].label}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <Button type="submit">Filtrar</Button>
            {hasFilters && (
              <Link href="/master/restaurantes" className="text-sm font-semibold text-text-muted hover:text-graphite">
                Limpar
              </Link>
            )}
          </div>
        </form>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          title={hasFilters ? "Nenhum restaurante encontrado" : "Nenhum restaurante cadastrado"}
          description={
            hasFilters ? "Tente outro termo de busca ou limpe os filtros." : "Os restaurantes aparecem aqui assim que os lojistas se cadastrarem."
          }
        />
      ) : (
        <>
          <Card className="hidden overflow-hidden md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface-subdued text-xs font-bold uppercase tracking-wide text-text-muted">
                <tr>
                  <th className="px-4 py-3">Restaurante</th>
                  <th className="px-4 py-3">Situação</th>
                  <th className="px-4 py-3">Plano</th>
                  <th className="px-4 py-3 text-right">Pedidos</th>
                  <th className="px-4 py-3">Último pedido</th>
                  <th className="px-4 py-3">Desde</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-subdued/60">
                    <td className="px-4 py-3">
                      <Link href={`/master/restaurantes/${row.id}`} className="font-bold text-graphite hover:text-primary">
                        {row.name}
                      </Link>
                      <p className="text-xs text-text-muted">/{row.slug}</p>
                    </td>
                    <td className="px-4 py-3">
                      <RestaurantBadges row={row} />
                    </td>
                    <td className="px-4 py-3">
                      <PlanCell row={row} />
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-graphite">{row.orders_total.toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-3 text-text-muted">{row.last_order_at ? formatDateTimeBR(row.last_order_at) : "—"}</td>
                    <td className="px-4 py-3 text-text-muted">{formatDateBR(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="space-y-3 md:hidden">
            {rows.map((row) => (
              <Link key={row.id} href={`/master/restaurantes/${row.id}`} className="block">
                <Card className="space-y-2 p-4">
                  <div>
                    <p className="font-bold text-graphite">{row.name}</p>
                    <p className="text-xs text-text-muted">/{row.slug}</p>
                  </div>
                  <RestaurantBadges row={row} />
                  <p className="text-sm">
                    <PlanCell row={row} />
                  </p>
                  <p className="text-xs text-text-muted">
                    {row.orders_total.toLocaleString("pt-BR")} pedidos · desde {formatDateBR(row.created_at)}
                  </p>
                </Card>
              </Link>
            ))}
          </div>

          {totalPages > 1 && (
            <nav className="flex items-center justify-between gap-3" aria-label="Paginação">
              {params.page > 1 ? (
                <Link
                  href={buildListHref({ ...params, page: params.page - 1 })}
                  className="text-sm font-semibold text-graphite hover:text-primary"
                >
                  ← Anterior
                </Link>
              ) : (
                <span />
              )}
              <span className="text-xs font-medium text-text-muted">
                Página {params.page} de {totalPages}
              </span>
              {params.page < totalPages ? (
                <Link
                  href={buildListHref({ ...params, page: params.page + 1 })}
                  className="text-sm font-semibold text-graphite hover:text-primary"
                >
                  Próxima →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
