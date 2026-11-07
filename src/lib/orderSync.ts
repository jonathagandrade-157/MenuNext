import type { OrderStatus } from "./orders";

/**
 * Regras puras da sincronização ao vivo do Kanban/KDS (testáveis sem navegador):
 *  - notificar UM pedido novo uma única vez, mesmo com evento repetido, reconexão ou resincronização;
 *  - depois de uma queda de conexão, a lista buscada no banco é a verdade: o que já estava na tela não toca de novo,
 *    o que chegou durante a queda é destacado e avisado.
 */
export type SyncOrder = { id: string; status: OrderStatus };

export const RESYNC_MIN_INTERVAL_MS = 3_000;
export const POLL_WHILE_DISCONNECTED_MS = 15_000;

/** Marca o pedido como já notificado. Devolve true só na PRIMEIRA vez (quem chama toca o som e destaca). */
export function claimNotification(notified: Set<string>, orderId: string): boolean {
  if (notified.has(orderId)) return false;
  notified.add(orderId);
  return true;
}

export type ResyncPlan<T extends SyncOrder> = { orders: T[]; newOrderIds: string[] };

/**
 * `fetched` = pedidos ativos hoje no banco (autoridade). `known` = o que a tela já tinha.
 * Pedidos novos (não estavam na tela, ainda não notificados e com status "received") entram em `newOrderIds`.
 * Os ids novos são registrados em `notified` aqui (uma resincronização repetida não os avisa de novo).
 */
export function planResync<T extends SyncOrder>(known: SyncOrder[], fetched: T[], notified: Set<string>): ResyncPlan<T> {
  const knownIds = new Set(known.map((o) => o.id));
  const newOrderIds: string[] = [];
  for (const order of fetched) {
    if (knownIds.has(order.id)) {
      notified.add(order.id);
      continue;
    }
    if (order.status === "received" && claimNotification(notified, order.id)) newOrderIds.push(order.id);
    else notified.add(order.id);
  }
  return { orders: fetched, newOrderIds };
}

/** Evita rajadas de resincronização (reconexão + volta de aba + online disparando juntos). */
export function shouldResync(lastResyncAt: number | null, now: number, minIntervalMs = RESYNC_MIN_INTERVAL_MS): boolean {
  return lastResyncAt === null || now - lastResyncAt >= minIntervalMs;
}

export function countPendingOrders(orders: SyncOrder[]): number {
  return orders.filter((o) => o.status === "received").length;
}

/** Título da aba com o número de pedidos novos aguardando: "(2) Pedidos". */
export function titleWithPending(baseTitle: string, pending: number): string {
  return pending > 0 ? `(${pending > 99 ? "99+" : pending}) ${baseTitle}` : baseTitle;
}

export type ConnectionState = "connecting" | "live" | "reconnecting";

/** Traduz o status do canal do Supabase para o estado exibido. */
export function connectionFromChannelStatus(status: string): ConnectionState {
  if (status === "SUBSCRIBED") return "live";
  if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") return "reconnecting";
  return "connecting";
}
