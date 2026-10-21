"use client";

import { Bike, Clock, ShoppingBag, Store } from "lucide-react";
import { FULFILLMENT_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/checkout";
import { ORDER_STATUS_ACTION_LABEL, formatCurrencyBRL, formatOrderTime, getNextOrderStatus, type OrderWithItems } from "@/lib/orders";

export function OrderCard({
  order,
  isNew,
  isAdvancing,
  onOpenDetails,
  onAdvance,
  elapsedMinutes,
  isOverdue = false,
  accentClass = "border-l-primary",
}: {
  order: OrderWithItems;
  isNew: boolean;
  isAdvancing: boolean;
  onOpenDetails: () => void;
  onAdvance: () => void;
  /** Classe da borda de acento (cor da etapa da coluna). */
  accentClass?: string;
  /** Minutos decorridos no status atual (KDS, JON-23) — omitido no Kanban
   * operacional de /painel/pedidos, que não passa esta prop. */
  elapsedMinutes?: number;
  isOverdue?: boolean;
}) {
  const nextStatus = getNextOrderStatus(order.status, order.fulfillment_type);
  const actionLabel = nextStatus ? ORDER_STATUS_ACTION_LABEL[nextStatus] : null;

  return (
    <div
      className={`rounded-xl border-l-4 bg-surface-card p-3.5 shadow-card transition-all hover:shadow-md ${accentClass} ${
        isNew ? "ring-2 ring-primary/40" : ""
      }`}
    >
      <button type="button" onClick={onOpenDetails} className="w-full text-left">
        <div className="flex items-center justify-between gap-2">
          <p className="text-headline-sm font-extrabold text-primary">#{order.order_number}</p>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-label-sm text-primary">
            {formatOrderTime(order.created_at)}
          </span>
        </div>

        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="truncate text-body-lg font-bold text-graphite">{order.customer_name}</p>
          <span className="inline-flex shrink-0 items-center gap-1 text-label-sm text-text-muted">
            {order.fulfillment_type === "delivery" ? (
              <Bike className="h-3.5 w-3.5" aria-hidden />
            ) : order.fulfillment_type === "counter" ? (
              <ShoppingBag className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Store className="h-3.5 w-3.5" aria-hidden />
            )}
            {FULFILLMENT_TYPE_LABELS[order.fulfillment_type]}
          </span>
        </div>

        {elapsedMinutes !== undefined && (
          <p
            className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-label-sm ${
              isOverdue ? "bg-red/10 text-red" : "bg-surface-subdued text-text-muted"
            }`}
          >
            <Clock className="h-3 w-3" aria-hidden />
            {elapsedMinutes} min{isOverdue ? " · atrasado" : ""}
          </p>
        )}

        <div className="mt-2 space-y-0.5">
          {order.order_items.map((item) => (
            <div key={item.id} className="text-[11px] text-text-muted">
              <span className="font-semibold text-graphite">{item.quantity}x</span> {item.product_name}
              {item.order_item_addons.length > 0 && (
                <span> — {item.order_item_addons.map((a) => a.addon_name).join(", ")}</span>
              )}
            </div>
          ))}
        </div>

        {order.observation && (
          <p className="mt-1.5 text-[11px] italic text-text-muted">&ldquo;{order.observation}&rdquo;</p>
        )}

        {order.fulfillment_type === "delivery" && order.delivery_street && (
          <p className="mt-1.5 truncate text-[11px] text-text-muted">
            {order.delivery_street}, {order.delivery_number} — {order.delivery_neighborhood}
          </p>
        )}

        <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
          <span className="text-[11px] font-medium text-text-muted">{PAYMENT_METHOD_LABELS[order.payment_method]}</span>
          <span className="text-sm font-extrabold text-graphite">{formatCurrencyBRL(order.total)}</span>
        </div>
      </button>

      {actionLabel && (
        <button
          type="button"
          onClick={onAdvance}
          disabled={isAdvancing}
          className="mt-2.5 flex h-9 w-full items-center justify-center rounded-lg bg-primary text-xs font-bold text-white transition-all hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isAdvancing ? "Atualizando..." : actionLabel}
        </button>
      )}
    </div>
  );
}
