/**
 * Aviso de pedido novo pelo navegador (Notification API). Opcional e DESLIGADO por padrão: o lojista liga num clique
 * (o navegador só deixa pedir permissão após um gesto do usuário). Só avisa com a aba em segundo plano — com a aba
 * aberta já há som e destaque. O texto NÃO leva nome nem telefone do cliente (a notificação aparece na tela
 * bloqueada). A preferência fica no próprio navegador (localStorage), nunca no servidor.
 */
export type NotifySupport = "unsupported" | "denied" | "default" | "granted";

const PREF_KEY = "menunext:browser-notify";

export function notifySupport(env: { Notification?: { permission: string } } = typeof window === "undefined" ? {} : (window as never)): NotifySupport {
  const n = env.Notification;
  if (!n) return "unsupported";
  return n.permission === "granted" || n.permission === "denied" ? n.permission : "default";
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function loadNotifyPref(storage?: StorageLike): boolean {
  try {
    const s = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    return s?.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveNotifyPref(on: boolean, storage?: StorageLike): void {
  try {
    const s = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    s?.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    // armazenamento bloqueado: a preferência vale só nesta sessão
  }
}

export type NotifiableOrder = { id: string; order_number: number; total: number; fulfillment_type: "delivery" | "pickup" | "counter" };

const TYPE_LABEL = { delivery: "Entrega", pickup: "Retirada", counter: "Balcão" } as const;

export function buildOrderNotification(orders: NotifiableOrder[]): { title: string; body: string; tag: string } | null {
  if (orders.length === 0) return null;
  const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (orders.length === 1) {
    const o = orders[0];
    return { title: `Novo pedido #${o.order_number}`, body: `${TYPE_LABEL[o.fulfillment_type] ?? "Pedido"} · ${brl(o.total)}`, tag: `order-${o.id}` };
  }
  return { title: `${orders.length} novos pedidos`, body: `Total ${brl(orders.reduce((a, o) => a + Number(o.total), 0))}`, tag: "orders-batch" };
}

/** Decide se deve notificar: preferência ligada, permissão concedida e aba em segundo plano. */
export function shouldNotify(input: { enabled: boolean; support: NotifySupport; hidden: boolean }): boolean {
  return input.enabled && input.support === "granted" && input.hidden;
}

/** Mostra a notificação; qualquer falha é silenciosa (o som e o destaque continuam). */
export function showOrderNotification(orders: NotifiableOrder[]): void {
  try {
    const payload = buildOrderNotification(orders);
    if (!payload) return;
    const n = new Notification(payload.title, { body: payload.body, tag: payload.tag });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // alguns navegadores móveis exigem service worker; sem ele, simplesmente não avisa
  }
}
