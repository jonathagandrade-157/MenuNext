import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { formatCurrencyBRL, formatOrderTime, type RecentOrder } from "@/lib/orders";

/**
 * "Pedidos recentes" (Sprint 4, Etapa 3) — nunca duplica a tela de Pedidos:
 * cada linha abre o pedido existente via /painel/pedidos?order=<id>, que o
 * PedidosTabs/OrderHistoryView já sabem interpretar (mesmo
 * OrderDetailModal usado no Kanban/Histórico).
 */
export function RecentOrdersCard({ orders }: { orders: RecentOrder[] }) {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-extrabold text-graphite">Pedidos recentes</h2>
        <LinkButton href="/painel/pedidos" variant="ghost" size="sm">
          Ver todos os pedidos
        </LinkButton>
      </div>

      {orders.length === 0 ? (
        <p className="py-10 text-center text-sm text-text-muted">Nenhum pedido recebido ainda.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/painel/pedidos?order=${order.id}`}
                className="flex items-center justify-between gap-3 py-3 hover:bg-surface-subdued"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-graphite">
                    #{order.order_number} · {order.customer_name}
                  </p>
                  <p className="text-xs text-text-muted">{formatOrderTime(order.created_at)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StatusBadge status={order.status} />
                  <p className="w-20 text-right text-sm font-bold text-graphite">{formatCurrencyBRL(order.total)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
