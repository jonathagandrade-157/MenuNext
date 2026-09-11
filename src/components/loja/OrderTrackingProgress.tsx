"use client";

import { ORDER_STATUS_LABEL, getOrderFlow, isTerminalOrderStatus, type FulfillmentType, type OrderStatus } from "@/lib/orders";
import { useOrderStatusRealtime } from "@/lib/useOrderStatusRealtime";

export function OrderTrackingProgress({
  publicId,
  initialStatus,
  fulfillmentType,
}: {
  publicId: string;
  initialStatus: OrderStatus;
  fulfillmentType: FulfillmentType;
}) {
  const status = useOrderStatusRealtime(publicId, initialStatus);
  const flow = getOrderFlow(fulfillmentType);
  const currentIndex = status === "cancelled" ? -1 : flow.indexOf(status);

  if (status === "cancelled") {
    return (
      <div className="rounded-2xl border border-red/20 bg-red/10 px-3.5 py-3 text-center text-sm font-bold text-red">
        Este pedido foi cancelado.
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {flow.map((step, index) => {
        const isDone = index < currentIndex;
        const isCurrent = index === currentIndex;
        const isLast = index === flow.length - 1;
        return (
          <div key={step} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  isDone || isCurrent ? "bg-primary text-white" : "bg-surface-subdued text-text-muted"
                } ${isCurrent ? "ring-4 ring-primary/20" : ""}`}
              >
                {isDone ? "✓" : index + 1}
              </span>
              {!isLast && <span className={`h-8 w-0.5 ${isDone ? "bg-primary" : "bg-border"}`} />}
            </div>
            <div className={`pb-8 ${isLast ? "pb-0" : ""}`}>
              <p className={`text-sm font-bold ${isDone || isCurrent ? "text-graphite" : "text-text-muted"}`}>
                {ORDER_STATUS_LABEL[step]}
              </p>
              {isCurrent && !isTerminalOrderStatus(status, fulfillmentType) && (
                <p className="text-xs text-text-muted">Em andamento agora</p>
              )}
              {isCurrent && isTerminalOrderStatus(status, fulfillmentType) && (
                <p className="text-xs font-semibold text-emerald">Concluído</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
