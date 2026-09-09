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

const ORDER_STATUS_LABEL: Record<string, { label: string; tone: StatusTone }> = {
  RECEIVED: { label: "Recebido", tone: "info" },
  CONFIRMED: { label: "Confirmado", tone: "info" },
  PREPARING: { label: "Em preparo", tone: "warning" },
  READY: { label: "Pronto", tone: "success" },
  OUT_FOR_DELIVERY: { label: "Saiu para entrega", tone: "success" },
  DELIVERED: { label: "Entregue", tone: "neutral" },
  COMPLETED: { label: "Concluído", tone: "neutral" },
  CANCELLED: { label: "Cancelado", tone: "danger" },
};

export function StatusBadge({ status }: { status: keyof typeof ORDER_STATUS_LABEL | string }) {
  const entry = ORDER_STATUS_LABEL[status] ?? { label: status, tone: "neutral" as StatusTone };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}
