/**
 * Aviso ao cliente pelo WhatsApp — "clique para conversar" (wa.me). NADA é enviado automaticamente: o link abre o
 * WhatsApp de quem está no painel com a mensagem já escrita, e a pessoa revisa e envia. Sem API paga, sem
 * credencial, sem migration, sem guardar nada novo. Envio automático (WhatsApp Cloud API) exige conta Meta
 * verificada, modelos aprovados e consentimento do cliente — ver docs/operacao/whatsapp.md.
 *
 * Módulo puro (testável sem DOM).
 */
import type { FulfillmentType, OrderStatus } from "./orders";

/**
 * Telefone brasileiro → formato internacional sem "+" (ex.: 5511988887777), ou null se não for um número válido.
 * Aceita com/sem máscara, com 0 de operadora/DDD na frente ("011...") e já com 55 ("+55 11 ...").
 */
export function normalizeBrazilPhone(raw: string | null | undefined): string | null {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) digits = digits.slice(2);
  else if ((digits.length === 11 || digits.length === 12) && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length !== 10 && digits.length !== 11) return null;
  const ddd = Number(digits.slice(0, 2));
  if (ddd < 11 || ddd > 99 || digits[2] === "0") return null;
  // celular (11 dígitos) começa com 9 depois do DDD
  if (digits.length === 11 && digits[2] !== "9") return null;
  return `55${digits}`;
}

export type OrderNoticeInput = {
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  customerName: string;
  storeName: string | null;
  orderNumber: number;
  total: number;
  /** Link público de acompanhamento; omitido quando não há (ou em status final). */
  trackingUrl?: string | null;
};

const brl = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value).replace(/ /g, " ");

function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first.slice(0, 40);
}

/** Texto da mensagem para o status ATUAL do pedido. */
export function buildOrderNoticeText(input: OrderNoticeInput): string {
  const name = firstName(input.customerName);
  const hello = name ? `Olá, ${name}!` : "Olá!";
  const store = input.storeName?.trim() ? ` na ${input.storeName.trim()}` : "";
  const order = `seu pedido #${input.orderNumber}${store}`;
  const isDelivery = input.fulfillmentType === "delivery";

  let body: string;
  switch (input.status) {
    case "received":
      body = `Recebemos ${order}. Total: ${brl(input.total)}.`;
      break;
    case "confirmed":
      body = `${capitalize(order)} foi confirmado.`;
      break;
    case "preparing":
      body = `${capitalize(order)} está sendo preparado.`;
      break;
    case "ready":
      body = isDelivery ? `${capitalize(order)} está pronto e logo sai para entrega.` : `${capitalize(order)} está pronto para retirada.`;
      break;
    case "out_for_delivery":
      body = `${capitalize(order)} saiu para entrega.`;
      break;
    case "delivered":
      body = `${capitalize(order)} foi entregue. Obrigado pela preferência!`;
      break;
    case "picked_up":
      body = `${capitalize(order)} foi retirado. Obrigado pela preferência!`;
      break;
    case "cancelled":
      body = `${capitalize(order)} foi cancelado. Se tiver alguma dúvida, é só responder esta mensagem.`;
      break;
    default:
      body = `Atualização sobre ${order}.`;
  }

  const terminal = input.status === "delivered" || input.status === "picked_up" || input.status === "cancelled";
  const tracking = !terminal && input.trackingUrl ? `\nAcompanhe: ${input.trackingUrl}` : "";
  return `${hello} ${body}${tracking}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Link wa.me com a mensagem; null quando o telefone não é válido (ex.: venda de balcão sem telefone). */
export function buildWhatsAppLink(phone: string | null | undefined, text: string): string | null {
  const number = normalizeBrazilPhone(phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/** Link público de acompanhamento do pedido (o public_id não adivinhável é a autorização, como na loja). */
export function buildTrackingUrl(origin: string, slug: string | null | undefined, publicId: string): string | null {
  if (!slug || !origin) return null;
  return `${origin.replace(/\/+$/, "")}/loja/${encodeURIComponent(slug)}/pedido/${encodeURIComponent(publicId)}/rastreamento`;
}
