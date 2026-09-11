"use client";

import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/Badge";
import { FULFILLMENT_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/checkout";
import { ORDER_STATUS_ACTION_LABEL, formatCurrencyBRL, formatOrderTime, getNextOrderStatus, type OrderWithItems } from "@/lib/orders";

export function OrderDetailModal({
  order,
  isAdvancing,
  onClose,
  onAdvance,
}: {
  order: OrderWithItems | null;
  isAdvancing: boolean;
  onClose: () => void;
  onAdvance: () => void;
}) {
  const nextStatus = order ? getNextOrderStatus(order.status, order.fulfillment_type) : null;
  const actionLabel = nextStatus ? ORDER_STATUS_ACTION_LABEL[nextStatus] : null;

  return (
    <Modal open={order !== null} onClose={onClose} title={order ? `Pedido #${order.order_number}` : ""}>
      {order && (
        <div className="max-h-[70vh] space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <StatusBadge status={order.status} />
            <span className="text-xs font-medium text-text-muted">{formatOrderTime(order.created_at)}</span>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Cliente</p>
            <p className="text-sm font-bold text-graphite">{order.customer_name}</p>
            <p className="text-sm text-text-muted">{order.customer_phone}</p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              {FULFILLMENT_TYPE_LABELS[order.fulfillment_type]}
            </p>
            {order.fulfillment_type === "delivery" ? (
              <p className="text-sm text-graphite">
                {order.delivery_street}, {order.delivery_number}
                {order.delivery_complement ? ` - ${order.delivery_complement}` : ""}
                <br />
                {order.delivery_neighborhood} — {order.delivery_city}
                {order.delivery_state ? `/${order.delivery_state}` : ""}
                {order.delivery_reference && (
                  <>
                    <br />
                    Referência: {order.delivery_reference}
                  </>
                )}
              </p>
            ) : (
              <p className="text-sm text-graphite">Retirada no restaurante.</p>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">Itens</p>
            <div className="space-y-2">
              {order.order_items.map((item) => (
                <div key={item.id} className="text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold text-graphite">
                      {item.quantity}x {item.product_name}
                    </span>
                    <span className="shrink-0 font-bold text-graphite">{formatCurrencyBRL(item.subtotal)}</span>
                  </div>
                  {item.order_item_addons.length > 0 && (
                    <p className="text-xs text-text-muted">
                      {item.order_item_addons.map((a) => `+ ${a.addon_name}`).join(" · ")}
                    </p>
                  )}
                  {item.observation && <p className="text-xs italic text-text-muted">&ldquo;{item.observation}&rdquo;</p>}
                </div>
              ))}
            </div>
          </div>

          {order.observation && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Observação do pedido</p>
              <p className="text-sm text-graphite">{order.observation}</p>
            </div>
          )}

          <div className="space-y-1 border-t border-border pt-3 text-sm">
            <div className="flex justify-between text-text-muted">
              <span>Subtotal</span>
              <span className="font-semibold text-graphite">{formatCurrencyBRL(order.subtotal)}</span>
            </div>
            {order.fulfillment_type === "delivery" && (
              <div className="flex justify-between text-text-muted">
                <span>Entrega</span>
                <span className="font-semibold text-graphite">{formatCurrencyBRL(order.delivery_fee)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-extrabold text-graphite">
              <span>Total</span>
              <span>{formatCurrencyBRL(order.total)}</span>
            </div>
            <div className="flex justify-between pt-1 text-text-muted">
              <span>Pagamento</span>
              <span className="font-semibold text-graphite">
                {PAYMENT_METHOD_LABELS[order.payment_method]}
                {order.payment_method === "cash" && order.change_for !== null && ` (troco para ${formatCurrencyBRL(order.change_for)})`}
              </span>
            </div>
          </div>

          {actionLabel && (
            <button
              type="button"
              onClick={onAdvance}
              disabled={isAdvancing}
              className="flex h-11 w-full items-center justify-center rounded-xl bg-primary text-sm font-bold text-white transition-all hover:bg-[#ff5436] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAdvancing ? "Atualizando..." : actionLabel}
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
