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
}: {
  restaurantId: string;
  initialActiveOrders: OrderWithItems[];
  initialHistoryOrders: OrderWithItems[];
}) {
  const [view, setView] = useState<View>("kanban");

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1.5 px-4 pt-4">
        <button
          type="button"
          onClick={() => setView("kanban")}
          className={`rounded-lg px-3.5 py-2 text-sm font-bold transition-colors ${
            view === "kanban" ? "bg-graphite text-white" : "text-text-muted hover:text-graphite"
          }`}
        >
          Kanban
        </button>
        <button
          type="button"
          onClick={() => setView("historico")}
          className={`rounded-lg px-3.5 py-2 text-sm font-bold transition-colors ${
            view === "historico" ? "bg-graphite text-white" : "text-text-muted hover:text-graphite"
          }`}
        >
          Histórico
        </button>
      </div>

      <div className="min-h-0 flex-1">
        {view === "kanban" ? (
          <KanbanBoard restaurantId={restaurantId} initialOrders={initialActiveOrders} />
        ) : (
          <OrderHistoryView initialOrders={initialHistoryOrders} />
        )}
      </div>
    </div>
  );
}
