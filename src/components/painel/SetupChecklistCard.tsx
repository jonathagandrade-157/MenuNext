import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import type { SetupChecklist } from "@/lib/setup";

/**
 * Checklist de configuração do painel — nunca bloqueia nada, é só um guia.
 * Todo o estado vem de `SetupChecklist` (calculado a partir de dados reais
 * em src/lib/setup.ts); este componente só apresenta.
 */
export function SetupChecklistCard({ checklist, storeSlug }: { checklist: SetupChecklist; storeSlug: string }) {
  if (checklist.isComplete) {
    return (
      <Card className="p-6 text-center">
        <p className="text-2xl">🎉</p>
        <h2 className="mt-2 text-lg font-extrabold text-graphite">Sua loja está pronta!</h2>
        <p className="mt-1 text-sm text-text-muted">Sua loja está 100% configurada.</p>
        <LinkButton href={`/loja/${storeSlug}`} className="mt-4">
          Ver minha loja
        </LinkButton>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-extrabold text-graphite">Configure sua loja</h2>
      <p className="mt-1 text-sm text-text-muted">Complete estas configurações para começar a vender.</p>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-text-muted">
          <span>Sua loja está {checklist.percent}% configurada</span>
          <span>
            {checklist.completedCount}/{checklist.totalCount}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-subdued">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${checklist.percent}%` }} />
        </div>
      </div>

      {checklist.percent < 100 && checklist.completedCount < checklist.totalCount && (
        <p className="mt-4 text-xs font-medium text-amber">
          Faltam algumas configurações para sua loja começar a vender.
        </p>
      )}

      <ul className="mt-5 divide-y divide-border">
        {checklist.items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 py-3">
            <Link href={item.actionHref} className="flex min-w-0 flex-1 items-start gap-3">
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  item.completed ? "bg-emerald text-white" : "border-2 border-border text-transparent"
                }`}
              >
                {item.completed ? "✓" : "○"}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-graphite">{item.title}</span>
                <span className="block truncate text-xs text-text-muted">
                  {item.completed ? item.completedDescription : item.pendingDescription}
                </span>
              </span>
            </Link>
            {!item.completed && (
              <Link
                href={item.actionHref}
                className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/5"
              >
                {item.actionLabel}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
