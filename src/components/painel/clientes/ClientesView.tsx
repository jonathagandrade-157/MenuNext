"use client";

import { Fragment, useMemo, useState } from "react";
import { StatusBadge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatCurrencyBRL, formatOrderDateTime } from "@/lib/orders";
import type { CustomerSummary } from "@/lib/customers";

function formatPhone(phone: string): string {
  if (phone.length === 11) return `(${phone.slice(0, 2)}) ${phone.slice(2, 7)}-${phone.slice(7)}`;
  if (phone.length === 10) return `(${phone.slice(0, 2)}) ${phone.slice(2, 6)}-${phone.slice(6)}`;
  return phone;
}

/**
 * Base de clientes (Fase 4.1) — agregação pura de `orders` (ver
 * aggregateCustomers em lib/customers.ts), nunca um CRM: busca simples por
 * nome/telefone e uma linha expansível com o histórico de pedidos de cada
 * cliente, sem tela própria por cliente.
 */
export function ClientesView({ customers }: { customers: CustomerSummary[] }) {
  const [search, setSearch] = useState("");
  const [expandedPhone, setExpandedPhone] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return customers;
    return customers.filter(
      (c) => c.name.toLowerCase().includes(query) || c.phone.includes(query.replace(/\D/g, ""))
    );
  }, [customers, search]);

  if (customers.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm font-semibold text-graphite">Nenhum cliente ainda</p>
        <p className="mt-1 text-sm text-text-muted">Assim que você receber o primeiro pedido, o cliente aparece aqui.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar por nome ou telefone"
        className="h-10 w-full max-w-sm rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
      />

      <div className="overflow-x-auto rounded-xl border border-border bg-surface-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
              <th className="px-3.5 py-2.5">Cliente</th>
              <th className="px-3.5 py-2.5">Telefone</th>
              <th className="px-3.5 py-2.5 text-right">Pedidos</th>
              <th className="px-3.5 py-2.5 text-right">Total gasto</th>
              <th className="px-3.5 py-2.5 text-right">Ticket médio</th>
              <th className="px-3.5 py-2.5">Último pedido</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((customer) => (
              <Fragment key={customer.phone}>
                <tr
                  onClick={() => setExpandedPhone((prev) => (prev === customer.phone ? null : customer.phone))}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-subdued"
                >
                  <td className="px-3.5 py-2.5 font-bold text-graphite">{customer.name}</td>
                  <td className="px-3.5 py-2.5 text-text-muted">{formatPhone(customer.phone)}</td>
                  <td className="px-3.5 py-2.5 text-right text-graphite">{customer.numberOfOrders}</td>
                  <td className="px-3.5 py-2.5 text-right font-bold text-graphite">{formatCurrencyBRL(customer.totalSpent)}</td>
                  <td className="px-3.5 py-2.5 text-right text-graphite">{formatCurrencyBRL(customer.averageTicket)}</td>
                  <td className="px-3.5 py-2.5 text-text-muted">{formatOrderDateTime(customer.lastOrderAt)}</td>
                </tr>
                {expandedPhone === customer.phone && (
                  <tr className="border-b border-border bg-surface-subdued/50">
                    <td colSpan={6} className="px-3.5 py-3">
                      {customer.addresses.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Endereços usados</p>
                          {customer.addresses.map((address) => (
                            <p key={address} className="text-sm text-graphite">
                              {address}
                            </p>
                          ))}
                        </div>
                      )}
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
                        Histórico de pedidos
                      </p>
                      <div className="space-y-1.5">
                        {customer.orders.map((order) => (
                          <div key={order.id} className="flex items-center justify-between gap-2 text-sm">
                            <span className="font-semibold text-graphite">#{order.orderNumber}</span>
                            <span className="text-text-muted">{formatOrderDateTime(order.createdAt)}</span>
                            <StatusBadge status={order.status} />
                            <span className="font-bold text-graphite">{formatCurrencyBRL(order.total)}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
