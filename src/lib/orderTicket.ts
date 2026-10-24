/**
 * Comanda (cupom) do pedido para impressão — só dados reais do pedido, texto
 * SEMPRE escapado (nome do cliente, endereço e observações vêm do cliente
 * final e nunca podem virar HTML). Sem dependência de navegador: devolve o
 * documento HTML completo; quem imprime (OrderDetailModal) só o coloca num
 * iframe e chama print().
 */
import { FULFILLMENT_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "./checkout";
import type { OrderWithItems } from "./orders";
import { discountLabel } from "./promotions";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function dateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

export function buildOrderTicketHtml(order: OrderWithItems, storeName: string | null = null): string {
  const e = escapeHtml;
  const items = order.order_items
    .map((item) => {
      const addons = item.order_item_addons.map((a) => `<div class="sub">+ ${e(a.addon_name)}</div>`).join("");
      const obs = item.observation ? `<div class="sub">“${e(item.observation)}”</div>` : "";
      return `<div class="row"><span><b>${item.quantity}x</b> ${e(item.product_name)}</span><span>${e(brl(item.subtotal))}</span></div>${addons}${obs}`;
    })
    .join("");

  const delivery =
    order.fulfillment_type === "delivery"
      ? `<div class="block"><b>Entrega</b><div>${e(
          [
            `${order.delivery_street ?? ""}, ${order.delivery_number ?? ""}`,
            order.delivery_complement,
            order.delivery_neighborhood,
            [order.delivery_city, order.delivery_state].filter(Boolean).join("/"),
          ]
            .filter((part) => part && part.trim() !== ",")
            .join(" - ")
        )}</div>${order.delivery_reference ? `<div>Ref.: ${e(order.delivery_reference)}</div>` : ""}</div>`
      : `<div class="block"><b>${e(FULFILLMENT_TYPE_LABELS[order.fulfillment_type])}</b></div>`;

  const observation = order.observation
    ? `<div class="block alert"><b>Observação</b><div>${e(order.observation)}</div></div>`
    : "";

  const discount =
    order.discount_amount > 0
      ? `<div class="row"><span>${e(discountLabel(order))}</span><span>-${e(brl(order.discount_amount))}</span></div>`
      : "";
  const fee =
    order.fulfillment_type === "delivery" ? `<div class="row"><span>Entrega</span><span>${e(brl(order.delivery_fee))}</span></div>` : "";
  const change =
    order.payment_method === "cash" && order.change_for !== null ? ` (troco para ${e(brl(order.change_for))})` : "";

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Pedido #${order.order_number}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { font: 12px/1.35 "Courier New", monospace; color: #000; width: 72mm; margin: 0; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .muted { color: #333; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .sub { padding-left: 14px; color: #222; }
  .block { border-top: 1px dashed #000; padding: 6px 0; }
  .alert { border: 2px solid #000; padding: 6px; margin: 6px 0; }
  .total { font-size: 14px; font-weight: bold; }
</style></head><body>
  <h1>${storeName ? `${e(storeName)} — ` : ""}Pedido #${order.order_number}</h1>
  <div class="muted">${e(dateTime(order.created_at))} · ${e(FULFILLMENT_TYPE_LABELS[order.fulfillment_type])}</div>
  <div class="block"><b>${e(order.customer_name)}</b><div>${e(order.customer_phone)}</div></div>
  ${delivery}
  <div class="block">${items}</div>
  ${observation}
  <div class="block">
    <div class="row"><span>Subtotal</span><span>${e(brl(order.subtotal))}</span></div>
    ${discount}${fee}
    <div class="row total"><span>Total</span><span>${e(brl(order.total))}</span></div>
    <div>Pagamento: ${e(PAYMENT_METHOD_LABELS[order.payment_method])}${change}</div>
  </div>
</body></html>`;
}
