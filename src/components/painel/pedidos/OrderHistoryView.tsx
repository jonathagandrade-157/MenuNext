"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { advanceOrderStatusAction, cancelOrderAction } from "@/lib/actions/orders";
import {
  ORDER_HISTORY_TABS,
  formatCurrencyBRL,
  formatOrderDateTime,
  orderTrackingChannelName,
  type OrderHistoryTabId,
  type OrderWithItems,
} from "@/lib/orders";
import { FULFILLMENT_TYPE_LABELS } from "@/lib/checkout";
import { StatusBadge } from "@/components/ui/Badge";
import { OrderDetailModal } from "./OrderDetailModal";

type PeriodFilter = "today" | "7d" | "30d" | "all";

const PERIOD_LABELS: Record<PeriodFilter, string> = {
  today: "Hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  all: "Todo o período",
};

function periodStartDate(period: PeriodFilter): Date | null {
  if (period === "all") return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (period === "7d") start.setDate(start.getDate() - 6);
  if (period === "30d") start.setDate(start.getDate() - 29);
  return start;
}

/**
 * Histórico de pedidos (Fase 4.1) — companheiro do Kanban em /painel/pedidos
 * (nunca o substitui, ver PedidosTabs). Busca uma única vez no servidor
 * (getOrderHistory) e filtra tudo no client: nenhuma query nova por filtro,
 * suficiente para o volume de um único restaurante no MVP.
 */
export function OrderHistoryView({
  initialOrders,
  initialSelectedOrderId = null,
}: {
  initialOrders: OrderWithItems[];
  initialSelectedOrderId?: string | null;
}) {
  const [orders, setOrders] = useState<OrderWithItems[]>(initialOrders);
  const [tab, setTab] = useState<OrderHistoryTabId>("all");
  const [period, setPeriod] = useState<PeriodFilter>("30d");
  const [search, setSearch] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(initialSelectedOrderId);
  const [advancingId, setAdvancingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeTab = ORDER_HISTORY_TABS.find((t) => t.id === tab) ?? ORDER_HISTORY_TABS[0];

  const filteredOrders = useMemo(() => {
    const start = periodStartDate(period);
    const query = search.trim().toLowerCase();

    return orders.filter((order) => {
      if (activeTab.statuses && !activeTab.statuses.includes(order.status)) return false;
      if (start && new Date(order.created_at) < start) return false;
      if (query) {
        const matchesNumber = String(order.order_number).includes(query);
        const matchesName = order.customer_name.toLowerCase().includes(query);
        const matchesPhone = order.customer_phone.replace(/\D/g, "").includes(query.replace(/\D/g, ""));
        if (!matchesNumber && !matchesName && !matchesPhone) return false;
      }
      return true;
    });
  }, [orders, activeTab, period, search]);

  const selectedOrder = orders.find((o) => o.id === selectedOrderId) ?? null;

  async function handleAdvance(order: OrderWithItems) {
    setErrorMessage(null);
    setAdvancingId(order.id);
    const result = await advanceOrderStatusAction(order.id);
    setAdvancingId(null);

    if (result.status === "error") {
      setErrorMessage(result.message);
      return;
    }

    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, ...result.order } : o)));

    try {
      const supabase = createClient();
      const trackingChannel = supabase.channel(orderTrackingChannelName(result.order.public_id));
      await trackingChannel.send({ type: "broadcast", event: "status_changed", payload: { status: result.order.status } });
      supabase.removeChannel(trackingChannel);
    } catch {
      // best-effort — ver mesmo comentário em KanbanBoard.handleAdvance.
    }
  }

  async function handleCancel(order: OrderWithItems, reason: string) {
    setErrorMessage(null);
    setCancellingId(order.id);
    const result = await cancelOrderAction(order.id, reason);
    setCancellingId(null);

    if (result.status === "error") {
      setErrorMessage(result.message);
      return;
    }

    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, ...result.order } : o)));
    setSelectedOrderId(null);

    try {
      const supabase = createClient();
      const trackingChannel = supabase.channel(orderTrackingChannelName(result.order.public_id));
      await trackingChannel.send({ type: "broadcast", event: "status_changed", payload: { status: result.order.status } });
      supabase.removeChannel(trackingChannel);
    } catch {
      // best-effort — ver mesmo comentário em KanbanBoard.handleCancel.
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
        {ORDER_HISTORY_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
              tab === t.id ? "bg-primary text-white" : "bg-surface-subdued text-text-muted hover:text-graphite"
            }`}
          >
            {t.title}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por cliente, telefone ou número do pedido"
          className="h-9 min-w-[240px] flex-1 rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
        />
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as PeriodFilter)}
          className="h-9 rounded-lg border border-border bg-surface-card px-2.5 text-sm text-graphite focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
        >
          {(Object.keys(PERIOD_LABELS) as PeriodFilter[]).map((key) => (
            <option key={key} value={key}>
              {PERIOD_LABELS[key]}
            </option>
          ))}
        </select>
      </div>

      {errorMessage && (
        <div className="mx-4 mt-3 rounded-lg border border-red/20 bg-red/10 px-3.5 py-2 text-xs font-semibold text-red">
          {errorMessage}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {filteredOrders.length === 0 ? (
          <p className="py-12 text-center text-sm text-text-muted">Nenhum pedido encontrado com esses filtros.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface-card">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                  <th className="px-3.5 py-2.5">Pedido</th>
                  <th className="px-3.5 py-2.5">Cliente</th>
                  <th className="px-3.5 py-2.5">Data</th>
                  <th className="px-3.5 py-2.5">Modalidade</th>
                  <th className="px-3.5 py-2.5">Status</th>
                  <th className="px-3.5 py-2.5 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <tr
                    key={order.id}
                    onClick={() => setSelectedOrderId(order.id)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-subdued"
                  >
                    <td className="px-3.5 py-2.5 font-bold text-graphite">#{order.order_number}</td>
                    <td className="px-3.5 py-2.5 text-graphite">{order.customer_name}</td>
                    <td className="px-3.5 py-2.5 text-text-muted">{formatOrderDateTime(order.created_at)}</td>
                    <td className="px-3.5 py-2.5 text-text-muted">{FULFILLMENT_TYPE_LABELS[order.fulfillment_type]}</td>
                    <td className="px-3.5 py-2.5">
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-bold text-graphite">{formatCurrencyBRL(order.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <OrderDetailModal
        order={selectedOrder}
        isAdvancing={advancingId === selectedOrder?.id}
        isCancelling={cancellingId === selectedOrder?.id}
        onClose={() => setSelectedOrderId(null)}
        onAdvance={() => selectedOrder && handleAdvance(selectedOrder)}
        onCancel={(reason) => selectedOrder && handleCancel(selectedOrder, reason)}
      />
    </div>
  );
}
