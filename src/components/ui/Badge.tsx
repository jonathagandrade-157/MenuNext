type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const toneClasses: Record<StatusTone, string> = {
  success: "bg-emerald/10 text-emerald",
  warning: "bg-amber/10 text-amber-strong",
  danger: "bg-red/10 text-red",
  info: "bg-blue/10 text-blue",
  neutral: "bg-surface-subdued text-text-muted",
};

type BadgeProps = {
  tone?: StatusTone;
  pulse?: boolean;
  children: React.ReactNode;
  className?: string;
};

export function Badge({ tone = "neutral", pulse, children, className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-label-md ${toneClasses[tone]} ${className}`}
    >
      {pulse && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />}
      {children}
    </span>
  );
}

// Chaves iguais aos status REAIS gravados em orders.status (minúsculas,
// snake_case — ver migration add_public_checkout_and_orders.sql/Fase 3.3).
// Corrigido na Fase 3.4: a versão anterior usava chaves inventadas em
// maiúsculo (scaffold da Sprint 0) que nunca bateriam com o dado real do
// banco — StatusBadge nunca tinha sido usado com dado real até agora.
const ORDER_STATUS_LABEL: Record<string, { label: string; tone: StatusTone }> = {
  received: { label: "Recebido", tone: "info" },
  confirmed: { label: "Confirmado", tone: "info" },
  preparing: { label: "Em preparo", tone: "warning" },
  ready: { label: "Pronto", tone: "success" },
  out_for_delivery: { label: "Saiu para entrega", tone: "success" },
  delivered: { label: "Entregue", tone: "neutral" },
  picked_up: { label: "Retirado", tone: "neutral" },
  cancelled: { label: "Cancelado", tone: "danger" },
};

export function StatusBadge({ status }: { status: keyof typeof ORDER_STATUS_LABEL | string }) {
  const entry = ORDER_STATUS_LABEL[status] ?? { label: status, tone: "neutral" as StatusTone };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}
