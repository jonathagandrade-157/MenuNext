"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, ChefHat, PackageCheck, Bike, Search, Volume2, VolumeX, type LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { advanceOrderStatusAction, cancelOrderAction } from "@/lib/actions/orders";
import {
  KANBAN_COLUMNS,
  getElapsedMinutesSince,
  getKanbanColumnForStatus,
  getActiveOrdersForKanban,
  getOrderWithItems,
  normalizeOrderFields,
  orderTrackingChannelName,
  type Order,
  type OrderWithItems,
} from "@/lib/orders";
import { playNewOrderChime } from "@/lib/sound";
import {
  loadNotifyPref, notifySupport, saveNotifyPref, shouldNotify, showOrderNotification,
  type NotifiableOrder, type NotifySupport,
} from "@/lib/browserNotify";
import {
  POLL_WHILE_DISCONNECTED_MS, claimNotification, connectionFromChannelStatus, countPendingOrders, planResync, shouldResync, titleWithPending,
  type ConnectionState,
} from "@/lib/orderSync";
import { OrderCard } from "./OrderCard";
import { OrderDetailModal } from "./OrderDetailModal";

const TERMINAL_STATUSES = new Set(["delivered", "picked_up", "cancelled"]);

/** Cor e ícone de cada etapa (borda do cartão, ponto, contador e métrica do topo). */
const COLUMN_STYLE: Record<string, { accent: string; dot: string; pill: string; text: string; tint: string; icon: LucideIcon }> = {
  novos: { accent: "border-l-primary", dot: "bg-primary", pill: "bg-primary text-white", text: "text-primary", tint: "bg-primary/10 text-primary", icon: BellRing },
  preparando: { accent: "border-l-amber", dot: "bg-amber", pill: "bg-amber text-white", text: "text-amber", tint: "bg-amber/10 text-amber", icon: ChefHat },
  prontos: { accent: "border-l-emerald", dot: "bg-emerald", pill: "bg-emerald text-white", text: "text-emerald", tint: "bg-emerald/10 text-emerald", icon: PackageCheck },
  saiu_para_entrega: { accent: "border-l-blue", dot: "bg-blue", pill: "bg-blue text-white", text: "text-blue", tint: "bg-blue/10 text-blue", icon: Bike },
  entregues: { accent: "border-l-slate-300", dot: "bg-slate-300", pill: "bg-slate-300 text-graphite", text: "text-text-muted", tint: "bg-surface-subdued text-text-muted", icon: PackageCheck },
};
const NEW_ORDER_HIGHLIGHT_MS = 6000;

/**
 * Kanban real (Fase 3.4) — fonte única de verdade é `orders` (+ order_items
 * + order_item_addons), lida uma vez no servidor (initialOrders, via
 * getActiveOrdersForKanban) e mantida em sincronia por Supabase Realtime
 * (postgres_changes em `orders`, filtrado por restaurant_id). A policy
 * "orders_select_members" (Fase 3.3) é o que garante que este canal nunca
 * entrega evento de outro restaurante — nenhum filtro de frontend é a
 * proteção real, só uma conveniência de UI.
 */
export function KanbanBoard({
  restaurantId,
  initialOrders,
  columns = KANBAN_COLUMNS,
  channelPrefix = "kanban",
  showElapsedTime = false,
  targetPrepMinutes = null,
  storeName = null,
  storeSlug = null,
}: {
  restaurantId: string;
  initialOrders: OrderWithItems[];
  /** Slug da loja: link de acompanhamento na mensagem de WhatsApp. */
  storeSlug?: string | null;
  /** Subconjunto de colunas a exibir — default são as 5 do Kanban
   * operacional; o KDS (JON-23, /painel/kds) passa KDS_COLUMNS. */
  columns?: typeof KANBAN_COLUMNS;
  /** Prefixo do canal Realtime — só para diferenciar nos logs/dashboard do
   * Supabase quando duas telas (Kanban e KDS) montam o board ao mesmo
   * tempo; não afeta isolamento (que é sempre por restaurantId). */
  channelPrefix?: string;
  /** Mostra "tempo decorrido no status atual" em cada card (KDS, JON-23) —
   * false no Kanban operacional, que não recebe esta prop. */
  showElapsedTime?: boolean;
  /** Meta de tempo de preparo (minutos) usada para marcar cards atrasados
   * quando showElapsedTime está ativo — vem de
   * computeDashboardMetrics.averagePrepMinutes, nunca um valor novo. */
  targetPrepMinutes?: number | null;
  /** Nome da loja na comanda impressa. */
  storeName?: string | null;
}) {
  const [orders, setOrders] = useState<OrderWithItems[]>(initialOrders);
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  const [advancingId, setAdvancingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [search, setSearch] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const soundEnabledRef = useRef(soundEnabled);
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);
  const supabaseRef = useRef(createClient());

  // Cronômetro do KDS — só liga o interval quando alguém de fato usa
  // showElapsedTime (Kanban operacional de /painel/pedidos nunca paga esse
  // custo). `now` começa null e só é setado no cliente para não divergir
  // do HTML de SSR (o servidor não tem por que saber a hora exata em que o
  // componente vai hidratar).
  useEffect(() => {
    if (!showElapsedTime) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mesmo padrão de ShareStoreModal: valor só existe no cliente, sem equivalente de SSR para evitar o efeito.
    setNow(new Date());
    const interval = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(interval);
  }, [showElapsedTime]);

  // Notificação única por pedido (evento repetido, reconexão e resincronização nunca avisam duas vezes).
  const notifiedRef = useRef<Set<string>>(new Set(initialOrders.map((o) => o.id)));
  const ordersRef = useRef(orders);
  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);
  const lastResyncRef = useRef<number | null>(null);
  // Aviso do navegador (opcional, desligado por padrão; preferência só neste navegador).
  const [browserNotify, setBrowserNotify] = useState(false);
  const [notifyState, setNotifyState] = useState<NotifySupport>("unsupported");
  const browserNotifyRef = useRef(false);
  useEffect(() => {
    browserNotifyRef.current = browserNotify;
  }, [browserNotify]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- preferência e permissão só existem no navegador
    setNotifyState(notifySupport());
    setBrowserNotify(loadNotifyPref());
  }, []);
  async function toggleBrowserNotify() {
    if (browserNotify) {
      setBrowserNotify(false);
      saveNotifyPref(false);
      return;
    }
    // O pedido de permissão só funciona dentro de um clique.
    const permission = notifySupport() === "granted" ? "granted" : await Notification.requestPermission();
    setNotifyState(notifySupport());
    if (permission === "granted") {
      setBrowserNotify(true);
      saveNotifyPref(true);
    }
  }
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  const highlightNew = useCallback((newOrders: NotifiableOrder[]) => {
    if (newOrders.length === 0) return;
    const ids = newOrders.map((o) => o.id);
    setNewOrderIds((prev) => new Set([...prev, ...ids]));
    if (soundEnabledRef.current) playNewOrderChime();
    if (shouldNotify({ enabled: browserNotifyRef.current, support: notifySupport(), hidden: document.visibilityState === "hidden" })) {
      showOrderNotification(newOrders);
    }
    setTimeout(() => {
      setNewOrderIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    }, NEW_ORDER_HIGHLIGHT_MS);
  }, []);

  // A lista do banco é a verdade: após queda de conexão, volta de aba ou rede, busca de novo e avisa só o que é novo.
  const resync = useCallback(async () => {
    if (!shouldResync(lastResyncRef.current, Date.now())) return;
    lastResyncRef.current = Date.now();
    try {
      const fetched = await getActiveOrdersForKanban(supabaseRef.current, restaurantId);
      const plan = planResync(ordersRef.current, fetched, notifiedRef.current);
      setOrders(plan.orders);
      highlightNew(plan.orders.filter((o) => plan.newOrderIds.includes(o.id)));
    } catch {
      // Falha de rede: o estado atual da tela é mantido e a próxima tentativa (reconexão/poll) corrige.
    }
  }, [restaurantId, highlightNew]);

  useEffect(() => {
    const supabase = supabaseRef.current;
    let connectedOnce = false;

    const channel = supabase
      .channel(`${channelPrefix}-orders-${restaurantId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
        async (payload) => {
          const orderId = (payload.new as { id: string }).id;
          if (!claimNotification(notifiedRef.current, orderId)) return;
          let full: OrderWithItems | null = null;
          try {
            full = await getOrderWithItems(supabase, orderId);
          } catch {
            full = null;
          }
          if (!full) {
            // Não conseguiu ler agora: libera o aviso e deixa a ressincronização trazer o pedido.
            notifiedRef.current.delete(orderId);
            void resync();
            return;
          }
          const loaded = full;
          setOrders((prev) => (prev.some((o) => o.id === loaded.id) ? prev : [...prev, loaded]));
          highlightNew([loaded]);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
        (payload) => {
          const updated = normalizeOrderFields(payload.new as Order);
          setOrders((prev) => {
            if (TERMINAL_STATUSES.has(updated.status)) {
              return prev.filter((o) => o.id !== updated.id);
            }
            return prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o));
          });
        }
      )
      .subscribe((status) => {
        setConnection(connectionFromChannelStatus(status));
        if (status === "SUBSCRIBED") {
          // Reconexão (não a primeira): pedidos podem ter chegado durante a queda.
          if (connectedOnce) void resync();
          connectedOnce = true;
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [restaurantId, channelPrefix, resync, highlightNew]);

  // Aba em segundo plano/rede que volta: ressincroniza. Enquanto desconectado, também consulta a cada 15 s.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void resync();
    };
    const onOnline = () => void resync();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    const poll = connection === "live" ? null : setInterval(() => void resync(), POLL_WHILE_DISCONNECTED_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      if (poll) clearInterval(poll);
    };
  }, [connection, resync]);

  // Contador de pedidos novos no título da aba.
  const pendingCount = countPendingOrders(orders);
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\)\s/, "");
    document.title = titleWithPending(base, pendingCount);
    return () => {
      document.title = base;
    };
  }, [pendingCount]);

  const handleAdvance = useCallback(async (order: OrderWithItems) => {
    setErrorMessage(null);
    setAdvancingId(order.id);
    const result = await advanceOrderStatusAction(order.id);
    setAdvancingId(null);

    if (result.status === "error") {
      setErrorMessage(result.message);
      return;
    }

    const updated = result.order;
    setOrders((prev) => {
      if (TERMINAL_STATUSES.has(updated.status)) return prev.filter((o) => o.id !== order.id);
      return prev.map((o) => (o.id === order.id ? { ...o, ...updated } : o));
    });

    // Broadcast best-effort para o tracking público (canal não-privado,
    // aberto: o public_id no nome do canal já é a autorização — ver
    // migration add_order_status_transitions.sql, seção 4). Se falhar
    // (ninguém ouvindo, rede instável), o tracking ainda mostra o status
    // certo no próximo carregamento via get_public_order — nunca depende
    // só disto.
    try {
      const trackingChannel = supabaseRef.current.channel(orderTrackingChannelName(updated.public_id));
      await trackingChannel.send({ type: "broadcast", event: "status_changed", payload: { status: updated.status } });
      supabaseRef.current.removeChannel(trackingChannel);
    } catch {
      // best-effort — sem impacto funcional, ver comentário acima.
    }
  }, []);

  const handleCancel = useCallback(async (order: OrderWithItems, reason: string) => {
    setErrorMessage(null);
    setCancellingId(order.id);
    const result = await cancelOrderAction(order.id, reason);
    setCancellingId(null);

    if (result.status === "error") {
      setErrorMessage(result.message);
      return;
    }

    setOrders((prev) => prev.filter((o) => o.id !== order.id));
    setSelectedOrderId(null);

    try {
      const trackingChannel = supabaseRef.current.channel(orderTrackingChannelName(result.order.public_id));
      await trackingChannel.send({ type: "broadcast", event: "status_changed", payload: { status: result.order.status } });
      supabaseRef.current.removeChannel(trackingChannel);
    } catch {
      // best-effort — ver comentário equivalente em handleAdvance.
    }
  }, []);

  const selectedOrder = orders.find((o) => o.id === selectedOrderId) ?? null;

  const query = search.trim().toLowerCase();
  const visibleOrders = query
    ? orders.filter((o) => `${o.order_number}`.includes(query) || o.customer_name.toLowerCase().includes(query))
    : orders;

  const countByColumn = (columnId: string) => orders.filter((o) => getKanbanColumnForStatus(o.status) === columnId).length;

  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-2 gap-3 px-4 pt-3 sm:grid-cols-4">
        {columns
          .filter((column) => column.id !== "entregues")
          .map((column) => {
            const style = COLUMN_STYLE[column.id];
            const Icon = style.icon;
            return (
              <div key={column.id} className="flex items-center justify-between rounded-xl bg-surface-card p-3 shadow-card">
                <div>
                  <p className="text-label-sm text-text-muted">{column.title}</p>
                  <p className={`text-headline-lg ${countByColumn(column.id) > 0 ? style.text : "text-graphite"}`}>
                    {countByColumn(column.id)}
                  </p>
                </div>
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${style.tint}`}>
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
              </div>
            );
          })}
      </div>

      <div className="flex items-center gap-3 px-4 pt-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por pedido (#1048) ou cliente..."
            className="h-10 w-full rounded-xl border border-border bg-surface-card pl-9 pr-3 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
          />
        </div>
        <button
          type="button"
          onClick={() => setSoundEnabled((v) => !v)}
          title={soundEnabled ? "Som de novo pedido ativado" : "Som de novo pedido desativado"}
          aria-pressed={soundEnabled}
          className={`flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-label-md transition-colors ${
            soundEnabled ? "bg-surface-card text-graphite shadow-card hover:bg-surface-subdued" : "bg-surface-subdued text-text-muted"
          }`}
        >
          {soundEnabled ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}
          {soundEnabled ? "Som ativado" : "Som desativado"}
        </button>
        {notifyState !== "unsupported" && (
          <button
            type="button"
            onClick={() => void toggleBrowserNotify()}
            disabled={notifyState === "denied"}
            title={notifyState === "denied" ? "Notificações bloqueadas no navegador. Libere nas configurações do site." : "Avisar pelo navegador quando esta aba estiver em segundo plano"}
            aria-pressed={browserNotify}
            className={`flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-label-md transition-colors ${
              browserNotify ? "bg-surface-card text-graphite shadow-card hover:bg-surface-subdued" : "bg-surface-subdued text-text-muted"
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <BellRing className="h-4 w-4" aria-hidden />
            {notifyState === "denied" ? "Aviso bloqueado" : browserNotify ? "Aviso no navegador ligado" : "Avisar no navegador"}
          </button>
        )}
        <span
          role="status"
          aria-live="polite"
          className={`flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-label-md ${
            connection === "live" ? "bg-emerald/10 text-emerald" : "bg-amber/10 text-amber-strong"
          }`}
        >
          <span className={`h-2 w-2 rounded-full bg-current ${connection === "live" ? "" : "animate-pulse"}`} aria-hidden />
          {connection === "live" ? "Ao vivo" : connection === "connecting" ? "Conectando..." : "Reconectando..."}
        </span>
      </div>

      {errorMessage && (
        <div className="mx-4 mt-3 rounded-lg border border-red/20 bg-red/10 px-3.5 py-2 text-label-md text-red">
          {errorMessage}
        </div>
      )}

      <div className="flex flex-1 gap-4 overflow-x-auto p-4">
        {columns.map((column) => {
          const columnOrders = visibleOrders.filter((o) => getKanbanColumnForStatus(o.status) === column.id);
          const style = COLUMN_STYLE[column.id];
          return (
            <div key={column.id} className="flex w-72 shrink-0 flex-col rounded-2xl bg-surface-subdued p-2">
              <div className="flex items-center justify-between px-2 py-2">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${style.dot} ${column.id === "novos" && columnOrders.length > 0 ? "animate-pulse" : ""}`} aria-hidden />
                  <h2 className="text-body-lg font-bold uppercase tracking-tight text-graphite">{column.title}</h2>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-label-sm ${columnOrders.length > 0 ? style.pill : "bg-surface-card text-text-muted"}`}>
                  {columnOrders.length}
                </span>
              </div>
              <div className="flex-1 space-y-2.5 overflow-y-auto px-0.5 pb-2">
                {columnOrders.length === 0 && (
                  <p className="px-1 py-6 text-center text-body-sm text-text-muted">Nenhum pedido</p>
                )}
                {columnOrders.map((order) => {
                  const elapsedMinutes = showElapsedTime && now ? getElapsedMinutesSince(order, now) : undefined;
                  const isOverdue =
                    elapsedMinutes !== undefined && targetPrepMinutes !== null && elapsedMinutes > targetPrepMinutes;
                  return (
                    <OrderCard
                      key={order.id}
                      order={order}
                      isNew={newOrderIds.has(order.id)}
                      isAdvancing={advancingId === order.id}
                      onOpenDetails={() => setSelectedOrderId(order.id)}
                      onAdvance={() => handleAdvance(order)}
                      elapsedMinutes={elapsedMinutes}
                      isOverdue={isOverdue}
                      accentClass={style.accent}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <OrderDetailModal
        order={selectedOrder}
        storeName={storeName}
        storeSlug={storeSlug}
        isAdvancing={advancingId === selectedOrder?.id}
        isCancelling={cancellingId === selectedOrder?.id}
        onClose={() => setSelectedOrderId(null)}
        onAdvance={() => selectedOrder && handleAdvance(selectedOrder)}
        onCancel={(reason) => selectedOrder && handleCancel(selectedOrder, reason)}
      />
    </div>
  );
}
