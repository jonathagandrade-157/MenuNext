"use client";

import { FULFILLMENT_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/checkout";
import { ORDER_STATUS_ACTION_LABEL, formatCurrencyBRL, formatOrderTime, getNextOrderStatus, type OrderWithItems } from "@/lib/orders";

export function OrderCard({
  order,
  isNew,
  isAdvancing,
  onOpenDetails,
  onAdvance,
}: {
  order: OrderWithItems;
  isNew: boolean;
  isAdvancing: boolean;
  onOpenDetails: () => void;
  onAdvance: () => void;
}) {
  const nextStatus = getNextOrderStatus(order.status, order.fulfillment_type);
  const actionLabel = nextStatus ? ORDER_STATUS_ACTION_LABEL[nextStatus] : null;

  return (
    <div
      className={`rounded-xl border bg-surface-card p-3.5 shadow-[var(--shadow-card)] transition-all ${
        isNew ? "border-primary ring-2 ring-primary/30" : "border-border"
      }`}
    >
      <button type="button" onClick={onOpenDetails} className="w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-extrabold text-graphite">#{order.order_number}</p>
            <p className="text-xs font-semibold text-graphite">{order.customer_name}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-medium text-text-muted">{formatOrderTime(order.created_at)}</p>
            <p className="text-[11px] font-bold text-primary">{FULFILLMENT_TYPE_LABELS[order.fulfillment_type]}</p>
          </div>
        </div>

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
          className="mt-2.5 flex h-9 w-full items-center justify-center rounded-lg bg-primary text-xs font-bold text-white transition-all hover:bg-[#ff5436] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isAdvancing ? "Atualizando..." : actionLabel}
        </button>
      )}
    </div>
  );
}
