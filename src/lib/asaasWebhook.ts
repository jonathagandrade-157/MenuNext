export type AsaasWebhookBody = {
  id?: string;
  event?: string;
  payment?: { id?: string; subscription?: string };
  subscription?: { id?: string };
};

export type SubscriptionStatusChange = {
  status: "active" | "overdue" | "cancelled";
  subscriptionId: string;
  eventId: string;
};

// Só o pagamento da assinatura alterna active/overdue. Excluir ou estornar
// UMA cobrança (PAYMENT_DELETED/REFUNDED) não é cancelamento da assinatura —
// o sinal de cancelamento é o evento de assinatura.
const STATUS_BY_PAYMENT_EVENT: Record<string, "active" | "overdue"> = {
  PAYMENT_CONFIRMED: "active",
  PAYMENT_RECEIVED: "active",
  PAYMENT_OVERDUE: "overdue",
};

const CANCELLING_SUBSCRIPTION_EVENTS = new Set(["SUBSCRIPTION_DELETED", "SUBSCRIPTION_INACTIVATED"]);

/** Traduz um evento do Asaas em mudança de status da assinatura, ou null
 * quando o evento não deve alterar nada (reconhecido e ignorado). */
export function resolveSubscriptionStatusChange(body: AsaasWebhookBody): SubscriptionStatusChange | null {
  const eventType = body.event;
  if (!eventType) return null;

  let status: SubscriptionStatusChange["status"] | undefined;
  let subscriptionId: string | undefined;

  if (Object.hasOwn(STATUS_BY_PAYMENT_EVENT, eventType)) {
    status = STATUS_BY_PAYMENT_EVENT[eventType];
    subscriptionId = body.payment?.subscription;
  } else if (CANCELLING_SUBSCRIPTION_EVENTS.has(eventType)) {
    status = "cancelled";
    subscriptionId = body.subscription?.id;
  }

  if (!status || !subscriptionId) return null;

  // `id` de topo (evt_...) é o identificador único do evento no Asaas; o
  // composto é só fallback caso o campo venha ausente.
  const eventId = body.id ?? `${eventType}:${body.payment?.id ?? subscriptionId}`;

  return { status, subscriptionId, eventId };
}
