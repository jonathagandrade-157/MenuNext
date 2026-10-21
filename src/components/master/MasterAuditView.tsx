import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { AUDIT_PAGE_SIZE, auditRoleLabel, type MasterAuditEntry } from "@/lib/audit";
import { formatDateTimeBR } from "@/lib/masterRestaurants";

const ACTION_LABEL: Record<MasterAuditEntry["action"], string> = { insert: "Criou", update: "Alterou", delete: "Removeu" };

function hrefFor(page: number, restaurantId: string | null): string {
  const query = new URLSearchParams();
  if (restaurantId) query.set("loja", restaurantId);
  if (page > 1) query.set("pagina", String(page));
  const qs = query.toString();
  return qs ? `/master/auditoria?${qs}` : "/master/auditoria";
}

export function MasterAuditView({
  rows,
  total,
  page,
  restaurantId,
}: {
  rows: MasterAuditEntry[];
  total: number;
  page: number;
  restaurantId: string | null;
}) {
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-headline-lg text-graphite">Auditoria e logs</h1>
        <p className="mt-0.5 text-body-md text-text-muted">
          Quem alterou o quê, em qual restaurante e quando. Mostra ações de pessoas nas telas de configuração; valores
          sensíveis (custos, chaves) nunca são gravados, só os nomes dos campos alterados.
        </p>
      </div>

      {restaurantId && (
        <p className="text-body-md text-text-muted">
          Filtrando por um restaurante.{" "}
          <Link href="/master/auditoria" className="font-semibold text-primary underline">
            Ver todos
          </Link>
        </p>
      )}

      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-body-md text-text-muted">Nenhuma atividade registrada ainda.</p>
        ) : (
          <>
            {/* Celular: cartões. */}
            <ul className="divide-y divide-border md:hidden">
              {rows.map((row, index) => (
                <li key={`${row.created_at}-${index}`} className="space-y-1 px-4 py-3">
                  <p className="text-body-md text-graphite">{row.summary}</p>
                  <p className="text-body-sm text-text-muted">
                    {row.restaurant_name ?? "Plataforma"} · {row.actor_name} ({auditRoleLabel(row.actor_role)}) ·{" "}
                    {formatDateTimeBR(row.created_at)}
                  </p>
                </li>
              ))}
            </ul>

            {/* Tablet e desktop: tabela. */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] text-body-md">
                <thead>
                  <tr className="border-b border-border bg-surface-subdued/70 text-left text-label-sm uppercase text-text-muted">
                    <th className="px-4 py-3">Quando</th>
                    <th className="px-4 py-3">Restaurante</th>
                    <th className="px-4 py-3">Quem</th>
                    <th className="px-4 py-3">Ação</th>
                    <th className="px-4 py-3">O que mudou</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`${row.created_at}-${index}`} className="border-b border-border last:border-0">
                      <td className="whitespace-nowrap px-4 py-3 text-text-muted">{formatDateTimeBR(row.created_at)}</td>
                      <td className="px-4 py-3">
                        {row.restaurant_id ? (
                          <Link href={`/master/restaurantes/${row.restaurant_id}`} className="font-semibold text-graphite hover:text-primary">
                            {row.restaurant_name ?? "—"}
                          </Link>
                        ) : (
                          <span className="text-text-muted">Plataforma</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="block text-graphite">{row.actor_name}</span>
                        <span className="text-body-sm text-text-muted">{auditRoleLabel(row.actor_role)}</span>
                      </td>
                      <td className="px-4 py-3 text-graphite">{ACTION_LABEL[row.action]}</td>
                      <td className="px-4 py-3 text-graphite">{row.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {total > 0 && (
        <nav aria-label="Paginação" className="flex items-center justify-between gap-3 text-body-md text-text-muted">
          <span>
            Página {page} de {pageCount} · {total.toLocaleString("pt-BR")} registros
          </span>
          <span className="flex gap-2">
            {page > 1 && (
              <Link href={hrefFor(page - 1, restaurantId)} className="rounded-xl border border-border bg-surface-card px-3 py-1.5 text-label-md text-graphite hover:bg-surface-subdued">
                Anterior
              </Link>
            )}
            {page < pageCount && (
              <Link href={hrefFor(page + 1, restaurantId)} className="rounded-xl border border-border bg-surface-card px-3 py-1.5 text-label-md text-graphite hover:bg-surface-subdued">
                Próxima
              </Link>
            )}
          </span>
        </nav>
      )}
    </div>
  );
}
