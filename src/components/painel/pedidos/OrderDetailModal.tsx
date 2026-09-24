"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/Badge";
import { FULFILLMENT_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/checkout";
import {
  CANCEL_REASONS,
  ORDER_STATUS_ACTION_LABEL,
  formatCurrencyBRL,
  formatOrderTime,
  getNextOrderStatus,
  isTerminalOrderStatus,
  type CancelReasonValue,
  type OrderWithItems,
} from "@/lib/orders";

export function OrderDetailModal({
  order,
  isAdvancing,
  isCancelling,
  onClose,
  onAdvance,
  onCancel,
}: {
  order: OrderWithItems | null;
  isAdvancing: boolean;
  isCancelling: boolean;
  onClose: () => void;
  onAdvance: () => void;
  onCancel: (reason: string) => void;
}) {
  const [cancelPanelOpen, setCancelPanelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState<CancelReasonValue>(CANCEL_REASONS[0].value);
  const [cancelOtherText, setCancelOtherText] = useState("");

  const nextStatus = order ? getNextOrderStatus(order.status, order.fulfillment_type) : null;
  const actionLabel = nextStatus ? ORDER_STATUS_ACTION_LABEL[nextStatus] : null;
  const canCancel = order ? !isTerminalOrderStatus(order.status, order.fulfillment_type) : false;

  function handleClose() {
    setCancelPanelOpen(false);
    setCancelReason(CANCEL_REASONS[0].value);
    setCancelOtherText("");
    onClose();
  }

  function handleConfirmCancel() {
    const label = CANCEL_REASONS.find((r) => r.value === cancelReason)?.label ?? cancelReason;
    const reason = cancelReason === "other" ? cancelOtherText.trim() : label;
    if (!reason) return;
    onCancel(reason);
  }

  return (
    <Modal open={order !== null} onClose={handleClose} title={order ? `Pedido #${order.order_number}` : ""}>
      {order && (
        <div className="max-h-[70vh] space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <StatusBadge status={order.status} />
            <span className="text-xs font-medium text-text-muted">{formatOrderTime(order.created_at)}</span>
          </div>

          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Cliente</p>
              <p className="text-sm font-bold text-graphite">{order.customer_name}</p>
              <p className="text-sm text-text-muted">{order.customer_phone}</p>
            </div>
            <a
              href={`https://wa.me/55${order.customer_phone.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 shrink-0 items-center rounded-lg bg-emerald px-3 text-xs font-semibold text-white transition-all hover:opacity-90"
            >
              WhatsApp
            </a>
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

          {cancelPanelOpen ? (
            <div className="space-y-3 rounded-xl border border-red/20 bg-red/5 p-3.5">
              <p className="text-sm font-bold text-graphite">Cancelar pedido</p>
              <div className="space-y-1.5">
                {CANCEL_REASONS.map((reason) => (
                  <label key={reason.value} className="flex cursor-pointer items-center gap-2 text-sm text-graphite">
                    <input
                      type="radio"
                      name="cancel_reason"
                      value={reason.value}
                      checked={cancelReason === reason.value}
                      onChange={() => setCancelReason(reason.value)}
                      className="h-4 w-4 accent-red"
                    />
                    {reason.label}
                  </label>
                ))}
              </div>
              {cancelReason === "other" && (
                <input
                  value={cancelOtherText}
                  onChange={(e) => setCancelOtherText(e.target.value)}
                  placeholder="Descreva o motivo"
                  maxLength={200}
                  className="h-10 w-full rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-red focus:outline-none focus:ring-[3px] focus:ring-red/15"
                />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCancelPanelOpen(false)}
                  disabled={isCancelling}
                  className="h-10 flex-1 rounded-lg border border-border text-sm font-semibold text-graphite hover:bg-surface-subdued disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCancel}
                  disabled={isCancelling || (cancelReason === "other" && !cancelOtherText.trim())}
                  className="h-10 flex-1 rounded-lg bg-red text-sm font-bold text-white hover:bg-[#dc2626] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCancelling ? "Cancelando..." : "Confirmar cancelamento"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              {actionLabel && (
                <button
                  type="button"
                  onClick={onAdvance}
                  disabled={isAdvancing}
                  className="flex h-11 flex-1 items-center justify-center rounded-xl bg-primary text-sm font-bold text-white transition-all hover:bg-[#ff5436] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isAdvancing ? "Atualizando..." : actionLabel}
                </button>
              )}
              {canCancel && (
                <button
                  type="button"
                  onClick={() => setCancelPanelOpen(true)}
                  className="flex h-11 items-center justify-center rounded-xl border border-red/30 px-4 text-sm font-bold text-red transition-all hover:bg-red/5"
                >
                  Cancelar
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
