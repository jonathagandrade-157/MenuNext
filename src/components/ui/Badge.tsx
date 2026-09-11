type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const toneClasses: Record<StatusTone, string> = {
  success: "bg-[#ECFDF5] text-[#059669]",
  warning: "bg-[#FFFBEB] text-[#B45309]",
  danger: "bg-[#FEF2F2] text-[#DC2626]",
  info: "bg-[#EFF6FF] text-blue",
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
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${toneClasses[tone]} ${className}`}
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
