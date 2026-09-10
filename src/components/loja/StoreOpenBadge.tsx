import type { StoreOpenState } from "@/lib/store";

const LABEL_BY_STATUS: Record<StoreOpenState["status"], { label: string; className: string }> = {
  open: { label: "Aberto agora", className: "bg-emerald/10 text-emerald border-emerald/20" },
  closed_hours: { label: "Fechado no momento", className: "bg-surface-subdued text-text-muted border-border" },
  paused: { label: "Pausada temporariamente", className: "bg-amber/10 text-amber border-amber/20" },
  closed_permanently: { label: "Loja encerrada", className: "bg-red/10 text-red border-red/20" },
};

/** Badge de status real da loja — nunca "Aberto" fixo: vem de computeStoreOpenState. */
export function StoreOpenBadge({ state }: { state: StoreOpenState }) {
  const { label, className } = LABEL_BY_STATUS[state.status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${className}`}>
      <span
        className={`h-2 w-2 rounded-full ${state.status === "open" ? "bg-emerald animate-pulse" : "bg-current"}`}
      />
      {label}
    </span>
  );
}
