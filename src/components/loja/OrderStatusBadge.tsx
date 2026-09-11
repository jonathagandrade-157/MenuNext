"use client";

import { ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/orders";
import { useOrderStatusRealtime } from "@/lib/useOrderStatusRealtime";

export function OrderStatusBadgeLive({ publicId, initialStatus }: { publicId: string; initialStatus: OrderStatus }) {
  const status = useOrderStatusRealtime(publicId, initialStatus);
  return (
    <span className="mt-1 rounded-full border border-emerald/20 bg-surface-card px-3 py-1 text-xs font-bold text-emerald">
      {ORDER_STATUS_LABEL[status] ?? status}
    </span>
  );
}
