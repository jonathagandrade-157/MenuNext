/**
 * Normalização do payload do webhook do Asaas. Este módulo NÃO decide efeito
 * nenhum sobre a assinatura: só extrai, com checagem de tipo, os campos que o
 * banco precisa (process_asaas_webhook). Quem traduz evento → efeito
 * (confirmar, atrasar, cancelar...) e verifica assinatura, cliente e valor é
 * o banco, depois de autenticar o token.
 */
export type AsaasWebhookBody = {
  id?: unknown;
  event?: unknown;
  dateCreated?: unknown;
  payment?: {
    id?: unknown;
    customer?: unknown;
    subscription?: unknown;
    value?: unknown;
    dueDate?: unknown;
    paymentDate?: unknown;
    externalReference?: unknown;
  } | null;
  subscription?: {
    id?: unknown;
    customer?: unknown;
    externalReference?: unknown;
  } | null;
};

export type AsaasWebhookParams = {
  eventId: string;
  eventType: string;
  occurredAt: string | null;
  subscriptionId: string;
  customerId: string | null;
  paymentId: string | null;
  value: number | null;
  dueDate: string | null;
  paidAt: string | null;
  externalReference: string | null;
};

// Pré-filtro: eventos que o banco sabe tratar. Os demais (visualizações,
// splits, atualizações) são reconhecidos e descartados aqui para não gerar
// chamada ao banco; o banco ignora o que não conhecer de qualquer forma.
const PAYMENT_EVENTS = new Set([
  "PAYMENT_CREATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE",
  "PAYMENT_REFUNDED",
  "PAYMENT_DELETED",
  "PAYMENT_RESTORED",
  "PAYMENT_CHARGEBACK_REQUESTED",
]);
const SUBSCRIPTION_EVENTS = new Set(["SUBSCRIPTION_DELETED", "SUBSCRIPTION_INACTIVATED"]);

function str(value: unknown, max = 200): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

/** Data `YYYY-MM-DD`; qualquer outra forma vira null. */
function dateOnly(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** O Asaas envia `dateCreated` como "YYYY-MM-DD HH:mm:ss" no horário de Brasília. */
function eventTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2]}-03:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function amount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1_000_000 ? value : null;
}

/** Extrai os parâmetros do evento, ou null quando o evento não interessa ou o
 * payload é inconsistente (sem id de evento, sem assinatura). */
export function parseAsaasWebhook(body: AsaasWebhookBody | null | undefined): AsaasWebhookParams | null {
  if (!body || typeof body !== "object") return null;

  const eventType = str(body.event, 100);
  const eventId = str(body.id);
  if (!eventType || !eventId) return null;

  const occurredAt = eventTimestamp(body.dateCreated);

  if (PAYMENT_EVENTS.has(eventType)) {
    const payment = body.payment;
    const subscriptionId = str(payment?.subscription);
    if (!subscriptionId) return null; // cobrança avulsa, fora da assinatura
    return {
      eventId,
      eventType,
      occurredAt,
      subscriptionId,
      customerId: str(payment?.customer),
      paymentId: str(payment?.id),
      value: amount(payment?.value),
      dueDate: dateOnly(payment?.dueDate),
      paidAt: dateOnly(payment?.paymentDate),
      externalReference: str(payment?.externalReference),
    };
  }

  if (SUBSCRIPTION_EVENTS.has(eventType)) {
    const subscription = body.subscription;
    const subscriptionId = str(subscription?.id);
    if (!subscriptionId) return null;
    return {
      eventId,
      eventType,
      occurredAt,
      subscriptionId,
      customerId: str(subscription?.customer),
      paymentId: null,
      value: null,
      dueDate: null,
      paidAt: null,
      externalReference: str(subscription?.externalReference),
    };
  }

  return null;
}
