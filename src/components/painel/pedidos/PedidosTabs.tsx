"use client";

import { useState } from "react";
import { KanbanBoard } from "./KanbanBoard";
import { OrderHistoryView } from "./OrderHistoryView";
import type { OrderWithItems } from "@/lib/orders";

type View = "kanban" | "historico";

/**
 * Alterna entre o Kanban operacional (pedidos ativos, tempo real) e o
 * Histórico completo (Fase 4.1) — o Kanban existente NUNCA é substituído,
 * só ganha um companheiro para consultar pedidos concluídos/cancelados e
 * buscar por cliente/número/período.
 */
export function PedidosTabs({
  restaurantId,
  initialActiveOrders,
  initialHistoryOrders,
  initialSelectedOrderId = null,
  storeName = null,
}: {
  restaurantId: string;
  storeName?: string | null;
  initialActiveOrders: OrderWithItems[];
  initialHistoryOrders: OrderWithItems[];
  initialSelectedOrderId?: string | null;
}) {
  // Deep link do Dashboard (?order=<id>) abre direto no Histórico — o
  // Kanban só lista pedidos ativos, então um pedido já entregue/cancelado
  // não apareceria nele.
  const [view, setView] = useState<View>(initialSelectedOrderId ? "historico" : "kanban");

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-4">
        <div role="tablist" aria-label="Visão dos pedidos" className="inline-flex gap-1 rounded-xl bg-surface-subdued p-1">
          {(["kanban", "historico"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={`rounded-lg px-4 py-1.5 text-label-lg transition-colors ${
                view === id ? "bg-surface-card text-graphite shadow-card" : "text-text-muted hover:text-graphite"
              }`}
            >
              {id === "kanban" ? "Kanban" : "Histórico"}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {view === "kanban" ? (
          <KanbanBoard restaurantId={restaurantId} initialOrders={initialActiveOrders} storeName={storeName} />
        ) : (
          <OrderHistoryView initialOrders={initialHistoryOrders} initialSelectedOrderId={initialSelectedOrderId} />
        )}
      </div>
    </div>
  );
}
