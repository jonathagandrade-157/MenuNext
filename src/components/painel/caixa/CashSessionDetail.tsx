import Link from "next/link";
import { Card } from "@/components/ui/Card";
import {
  CASH_MOVEMENT_LABELS, formatCashDateTime, formatCashTime, summarizeCashSales,
  type CashHistoryRow, type CashMovement, type CashSale,
} from "@/lib/cash";
import { formatCurrencyBRL } from "@/lib/store";

const PAYMENT: Record<CashSale["paymentMethod"], string> = { cash: "Dinheiro", pix: "Pix", card: "Cartão" };

/** Detalhe de uma sessão de caixa: vendas por forma de pagamento, lista de vendas e movimentações. Só OWNER. */
export function CashSessionDetail({ session, sales, movements }: { session: CashHistoryRow; sales: CashSale[]; movements: CashMovement[] }) {
  const summary = summarizeCashSales(sales);
  return (
    <section aria-labelledby="cash-detail-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cash-detail-title" className="text-headline-sm text-graphite">
          Sessão de {formatCashDateTime(session.openedAt)}
          {session.closedAt ? ` → ${formatCashDateTime(session.closedAt)}` : " (em andamento)"}
        </h2>
        <Link href="/painel/caixa" className="text-label-lg text-primary hover:underline">Fechar detalhe</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4"><p className="text-label-md text-text-muted">Vendas</p><p className="text-headline-md text-graphite">{summary.orders}</p><p className="text-body-sm text-text-muted">{summary.cancelled} cancelada(s)</p></Card>
        <Card className="p-4"><p className="text-label-md text-text-muted">Total vendido</p><p className="text-headline-md text-graphite">{formatCurrencyBRL(summary.total)}</p></Card>
        {(["cash", "pix"] as const).map((k) => (
          <Card key={k} className="p-4"><p className="text-label-md text-text-muted">{PAYMENT[k]}</p><p className="text-headline-md text-graphite">{formatCurrencyBRL(summary.byPayment[k].total)}</p><p className="text-body-sm text-text-muted">{summary.byPayment[k].orders} venda(s)</p></Card>
        ))}
      </div>
      <p className="text-body-sm text-text-muted">Cartão: {formatCurrencyBRL(summary.byPayment.card.total)} ({summary.byPayment.card.orders} venda(s)).</p>

      <Card className="overflow-hidden p-0">
        {sales.length === 0 ? (
          <p className="px-5 py-6 text-center text-body-md text-text-muted">Nenhuma venda de balcão nesta sessão.</p>
        ) : (
          <ul className="divide-y divide-border">
            {sales.map((s) => (
              <li key={s.orderId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-body-md text-graphite">Pedido #{s.orderNumber} · {PAYMENT[s.paymentMethod]}</p>
                  <p className="text-body-sm text-text-muted">{formatCashTime(s.createdAt)}{s.status === "cancelled" ? " · cancelado" : ""}</p>
                </div>
                <span className={s.status === "cancelled" ? "text-text-muted line-through" : "font-semibold text-graphite"}>{formatCurrencyBRL(s.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {movements.length > 0 && (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-border">
            {movements.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-body-md text-graphite">{m.reason}</p>
                  <p className="text-body-sm text-text-muted">{CASH_MOVEMENT_LABELS[m.kind]} · {m.createdByName} · {formatCashTime(m.createdAt)}</p>
                </div>
                <span className={m.kind === "supply" ? "font-semibold text-emerald" : "font-semibold text-red"}>{m.kind === "supply" ? "+" : "−"}{formatCurrencyBRL(m.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
