import { History } from "lucide-react";
import { auditRoleLabel, type AuditEntry } from "@/lib/audit";
import { formatDateTimeBR } from "@/lib/masterRestaurants";

/** Lista curta de atividade recente (quem fez o quê e quando). Texto puro, vindo do registro do banco. */
export function AuditList({ entries, emptyText }: { entries: AuditEntry[]; emptyText: string }) {
  if (entries.length === 0) {
    return <p className="text-body-md text-text-muted">{emptyText}</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {entries.map((entry, index) => (
        <li key={`${entry.created_at}-${index}`} className="flex items-start gap-3 py-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-subdued text-text-muted">
            <History className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-body-md text-graphite">{entry.summary}</p>
            <p className="text-body-sm text-text-muted">
              {entry.actor_name} · {auditRoleLabel(entry.actor_role)} · {formatDateTimeBR(entry.created_at)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
