"use client";

import { useState } from "react";
import { Bike, Info, MapPin, MessageCircle, Printer, ShoppingBag, StickyNote, Store } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { StatusBadge } from "@/components/ui/Badge";
import { FULFILLMENT_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/checkout";
import { buildOrderTicketHtml } from "@/lib/orderTicket";
import {
  CANCEL_REASONS,
  ORDER_STATUS_ACTION_LABEL,
  ORDER_STATUS_LABEL,
  formatCurrencyBRL,
  formatOrderTime,
  getNextOrderStatus,
  isTerminalOrderStatus,
  type CancelReasonValue,
  type OrderWithItems,
} from "@/lib/orders";

function printOrderTicket(order: OrderWithItems, storeName: string | null) {
  // iframe invisível com a comanda já montada e escapada (src/lib/orderTicket.ts).
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  frame.srcdoc = buildOrderTicketHtml(order, storeName);
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  };
  document.body.appendChild(frame);
}

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="mb-2 text-label-sm uppercase tracking-wider text-text-muted">{children}</h3>
);

/**
 * Detalhe do pedido em gaveta lateral (padrão do Stitch). Mesma API e mesmas
 * regras da versão em modal: avançar etapa, cancelar com motivo, só dado real.
 */
export function OrderDetailModal({
  order,
  isAdvancing,
  isCancelling,
  onClose,
  onAdvance,
  onCancel,
  storeName = null,
}: {
  order: OrderWithItems | null;
  isAdvancing: boolean;
  isCancelling: boolean;
  onClose: () => void;
  onAdvance: () => void;
  onCancel: (reason: string) => void;
  /** Nome da loja na comanda impressa (opcional). */
  storeName?: string | null;
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

  const FulfillmentIcon = order?.fulfillment_type === "delivery" ? Bike : order?.fulfillment_type === "counter" ? ShoppingBag : Store;

  return (
    <Drawer
      open={order !== null}
      onClose={handleClose}
      title={order ? `Pedido #${order.order_number}` : ""}
      badge={order ? <StatusBadge status={order.status} /> : undefined}
      subtitle={order ? `${formatOrderTime(order.created_at)} · ${FULFILLMENT_TYPE_LABELS[order.fulfillment_type]}` : undefined}
      footer={
        order && !cancelPanelOpen ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => printOrderTicket(order, storeName)}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-surface-subdued text-label-lg text-graphite transition-colors hover:bg-border"
            >
              <Printer className="h-4 w-4" aria-hidden />
              Imprimir comanda
            </button>
            {canCancel && (
              <button
                type="button"
                onClick={() => setCancelPanelOpen(true)}
                className="flex h-11 items-center justify-center rounded-xl bg-red/10 px-4 text-label-lg text-red transition-colors hover:bg-red/15"
              >
                Cancelar pedido
              </button>
            )}
          </div>
        ) : undefined
      }
    >
      {order && (
        <>
          {actionLabel && !cancelPanelOpen && (
            <section className="rounded-2xl bg-primary/5 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-label-sm uppercase tracking-wider text-text-muted">Etapa atual</span>
                <span className="text-label-lg text-primary">{ORDER_STATUS_LABEL[order.status]}</span>
              </div>
              <button
                type="button"
                onClick={onAdvance}
                disabled={isAdvancing}
                className="mt-3 flex h-12 w-full items-center justify-center rounded-xl bg-primary text-label-lg font-bold text-white shadow-[0_4px_14px_rgba(171,47,0,0.3)] transition-all hover:bg-primary-container active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isAdvancing ? "Atualizando..." : actionLabel}
              </button>
            </section>
          )}

          {cancelPanelOpen && (
            <section className="space-y-3 rounded-2xl border border-red/20 bg-red/5 p-4">
              <p className="text-label-lg text-graphite">Cancelar pedido</p>
              <div className="space-y-1.5">
                {CANCEL_REASONS.map((reason) => (
                  <label key={reason.value} className="flex cursor-pointer items-center gap-2 text-body-md text-graphite">
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
                  className="h-10 w-full rounded-xl border border-border bg-surface-card px-3 text-body-md text-graphite placeholder:text-slate-400 focus:border-red focus:outline-none focus:ring-[3px] focus:ring-red/15"
                />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCancelPanelOpen(false)}
                  disabled={isCancelling}
                  className="h-10 flex-1 rounded-xl border border-border text-label-lg text-graphite hover:bg-surface-subdued disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCancel}
                  disabled={isCancelling || (cancelReason === "other" && !cancelOtherText.trim())}
                  className="h-10 flex-1 rounded-lg bg-red text-label-lg font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCancelling ? "Cancelando..." : "Confirmar cancelamento"}
                </button>
              </div>
            </section>
          )}

          <section>
            <SectionTitle>Cliente &amp; contato</SectionTitle>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-surface p-3.5">
              <div className="min-w-0">
                <p className="truncate text-headline-sm text-graphite">{order.customer_name}</p>
                <p className="text-body-sm text-text-muted">{order.customer_phone}</p>
              </div>
              <a
                href={`https://wa.me/55${order.customer_phone.replace(/\D/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-emerald/10 px-3 text-label-md font-bold text-emerald transition-colors hover:bg-emerald/15"
              >
                <MessageCircle className="h-4 w-4" aria-hidden />
                WhatsApp
              </a>
            </div>
          </section>

          <section>
            <SectionTitle>{order.fulfillment_type === "delivery" ? "Destino da entrega" : FULFILLMENT_TYPE_LABELS[order.fulfillment_type]}</SectionTitle>
            <div className="rounded-xl bg-surface p-3.5">
              {order.fulfillment_type === "delivery" ? (
                <div className="flex gap-2.5">
                  <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <div className="min-w-0 text-body-md text-graphite">
                    <p className="font-semibold">
                      {order.delivery_street}, {order.delivery_number}
                      {order.delivery_complement ? ` — ${order.delivery_complement}` : ""}
                    </p>
                    <p className="text-body-sm text-text-muted">
                      {order.delivery_neighborhood} — {order.delivery_city}
                      {order.delivery_state ? `/${order.delivery_state}` : ""}
                      {order.delivery_zip ? ` • CEP ${order.delivery_zip}` : ""}
                    </p>
                    {order.delivery_reference && (
                      <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-surface-card px-2.5 py-1.5 text-body-sm text-text-muted">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span>
                          <b className="text-graphite">Ref.:</b> {order.delivery_reference}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="flex items-center gap-2 text-body-md text-graphite">
                  <FulfillmentIcon className="h-5 w-5 text-primary" aria-hidden />
                  {order.fulfillment_type === "pickup" ? "Retirada no restaurante." : "Venda de balcão."}
                </p>
              )}
            </div>
          </section>

          {order.observation && (
            <section className="rounded-2xl bg-red/5 p-3.5">
              <p className="flex items-center gap-1.5 text-label-lg text-red">
                <StickyNote className="h-4 w-4" aria-hidden />
                Observação do cliente para a cozinha
              </p>
              <p className="mt-1 text-body-md italic text-graphite">&ldquo;{order.observation}&rdquo;</p>
            </section>
          )}

          <section>
            <SectionTitle>Itens do pedido ({order.order_items.length})</SectionTitle>
            <div className="divide-y divide-border rounded-xl bg-surface">
              {order.order_items.map((item) => (
                <div key={item.id} className="p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-body-md font-semibold text-graphite">
                      <span className="mr-2 rounded-md bg-surface-card px-1.5 py-0.5 text-label-sm text-text-muted">{item.quantity}x</span>
                      {item.product_name}
                    </p>
                    <span className="shrink-0 text-body-md font-bold text-graphite">{formatCurrencyBRL(item.subtotal)}</span>
                  </div>
                  {item.order_item_addons.length > 0 && (
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-8 text-body-sm text-text-muted">
                      {item.order_item_addons.map((a) => (
                        <li key={a.id}>
                          {a.addon_name}
                          {a.subtotal > 0 ? ` (+${formatCurrencyBRL(a.subtotal)})` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                  {item.observation && <p className="mt-1.5 pl-8 text-body-sm italic text-text-muted">&ldquo;{item.observation}&rdquo;</p>}
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-1.5 rounded-xl bg-surface p-3.5 text-body-md">
            <div className="flex justify-between text-text-muted">
              <span>Subtotal</span>
              <span className="font-semibold text-graphite">{formatCurrencyBRL(order.subtotal)}</span>
            </div>
            {order.discount_amount > 0 && (
              <div className="flex justify-between text-emerald">
                <span>Cupom ({order.coupon_code})</span>
                <span className="font-semibold">-{formatCurrencyBRL(order.discount_amount)}</span>
              </div>
            )}
            {order.fulfillment_type === "delivery" && (
              <div className="flex justify-between text-text-muted">
                <span>Entrega</span>
                <span className="font-semibold text-graphite">{formatCurrencyBRL(order.delivery_fee)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-2 text-headline-sm text-graphite">
              <span>Total</span>
              <span>{formatCurrencyBRL(order.total)}</span>
            </div>
            <div className="flex justify-between pt-1 text-text-muted">
              <span>Pagamento</span>
              <span className="text-right font-semibold text-graphite">
                {PAYMENT_METHOD_LABELS[order.payment_method]}
                {order.payment_method === "cash" && order.change_for !== null && ` (troco para ${formatCurrencyBRL(order.change_for)})`}
              </span>
            </div>
          </section>
        </>
      )}
    </Drawer>
  );
}
