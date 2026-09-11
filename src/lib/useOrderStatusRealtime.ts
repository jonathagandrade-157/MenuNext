"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { orderTrackingChannelName, type OrderStatus } from "@/lib/orders";

/**
 * Status ao vivo de UM pedido público, via broadcast (não postgres_changes —
 * dar acesso via postgres_changes ao cliente anônimo exigiria uma policy de
 * SELECT em `orders` para anon, o que reabriria listagem de pedidos; ver
 * migration add_order_status_transitions.sql, seção 4). O canal usa o
 * public_id como nome — não é preciso nenhuma autorização adicional porque
 * o UUID em si já é a mesma "senha" que get_public_order usa.
 *
 * `initialStatus` (vindo do SSR via get_public_order) é sempre o valor
 * inicial exibido — se o broadcast nunca chegar (guia sem ninguém
 * operando o pedido no momento, aba fechada no restaurante etc.), a
 * página continua correta porque foi renderizada com o status real no
 * momento do load; um novo load sempre busca o estado atual de novo.
 */
export function useOrderStatusRealtime(publicId: string, initialStatus: OrderStatus): OrderStatus {
  const [status, setStatus] = useState<OrderStatus>(initialStatus);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(orderTrackingChannelName(publicId))
      .on("broadcast", { event: "status_changed" }, (payload) => {
        const nextStatus = (payload.payload as { status?: OrderStatus } | undefined)?.status;
        if (nextStatus) setStatus(nextStatus);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [publicId]);

  return status;
}
