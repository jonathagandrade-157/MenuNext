"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { StatusBadge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/States";
import { addCustomerNoteAction } from "@/lib/actions/customerNotes";
import {
  computeCustomerStats,
  getCustomerSegments,
  type CustomerNote,
  type CustomerSegment,
  type CustomerSummary,
} from "@/lib/customers";
import { formatCurrencyBRL, formatOrderDateTime } from "@/lib/orders";

function formatPhone(phone: string): string {
  if (phone.length === 11) return `(${phone.slice(0, 2)}) ${phone.slice(2, 7)}-${phone.slice(7)}`;
  if (phone.length === 10) return `(${phone.slice(0, 2)}) ${phone.slice(2, 6)}-${phone.slice(6)}`;
  return phone;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  // BOM UTF-8: sem isso o Excel abre acentos quebrados em CSV.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="mt-1 text-xl font-black text-graphite">{value}</p>
    </Card>
  );
}

type Tab = "todos" | "recorrentes" | "novos" | "inativos";

const TABS: { id: Tab; label: string; segment?: CustomerSegment }[] = [
  { id: "todos", label: "Todos" },
  { id: "recorrentes", label: "Recorrentes", segment: "recorrente" },
  { id: "novos", label: "Novos", segment: "novo" },
  { id: "inativos", label: "Inativos", segment: "inativo" },
];

function NotesSection({
  phone,
  notes,
}: {
  phone: string;
  notes: CustomerNote[];
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await addCustomerNoteAction(phone, draft);
      if (!result.ok) {
        setError(result.error ?? "Não foi possível salvar.");
        return;
      }
      setDraft("");
    });
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
        Observações internas <span className="font-normal normal-case">(visível apenas para a equipe)</span>
      </p>
      {notes.length > 0 && (
        <div className="mb-2 space-y-1.5">
          {notes.map((noteRow) => (
            <div key={noteRow.id} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-graphite">
              {noteRow.note}
              <span className="ml-2 text-[11px] text-text-muted">{formatOrderDateTime(noteRow.created_at)}</span>
            </div>
          ))}
        </div>
      )}
      {error && <ErrorState message={error} />}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="+ Adicionar nova nota..."
          maxLength={500}
          className="h-9 w-full rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending || !draft.trim()}
          className="shrink-0 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white transition-all hover:bg-[#ff5436] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </div>
  );
}

/**
 * Base de clientes (Fase 4.1, redesign Stitch) — agregação pura de `orders`
 * (aggregateCustomers em lib/customers.ts), nunca um CRM: busca por
 * nome/telefone, segmentação (recorrente/novo/inativo — ver
 * getCustomerSegments) e uma linha expansível com histórico + observações
 * internas por cliente (customer_notes), sem tela própria por cliente.
 */
export function ClientesView({
  customers,
  notesByPhone,
  now,
}: {
  customers: CustomerSummary[];
  notesByPhone: Record<string, CustomerNote[]>;
  now: string;
}) {
  const nowDate = useMemo(() => new Date(now), [now]);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("todos");
  const [expandedPhone, setExpandedPhone] = useState<string | null>(null);

  const segmentsByPhone = useMemo(() => {
    const map = new Map<string, CustomerSegment[]>();
    for (const customer of customers) map.set(customer.phone, getCustomerSegments(customer, nowDate));
    return map;
  }, [customers, nowDate]);

  const stats = useMemo(() => computeCustomerStats(customers, nowDate), [customers, nowDate]);

  const tabCounts = useMemo(() => {
    const counts: Record<Tab, number> = { todos: customers.length, recorrentes: 0, novos: 0, inativos: 0 };
    for (const customer of customers) {
      const segments = segmentsByPhone.get(customer.phone) ?? [];
      if (segments.includes("recorrente")) counts.recorrentes++;
      if (segments.includes("novo")) counts.novos++;
      if (segments.includes("inativo")) counts.inativos++;
    }
    return counts;
  }, [customers, segmentsByPhone]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const activeTab = TABS.find((t) => t.id === tab);
    return customers.filter((customer) => {
      if (activeTab?.segment && !segmentsByPhone.get(customer.phone)?.includes(activeTab.segment)) return false;
      if (query && !customer.name.toLowerCase().includes(query) && !customer.phone.includes(query.replace(/\D/g, ""))) {
        return false;
      }
      return true;
    });
  }, [customers, search, tab, segmentsByPhone]);

  function handleExport() {
    const rows = [
      ["Cliente", "Telefone", "Pedidos", "Total gasto", "Ticket médio", "Último pedido"],
      ...filtered.map((c) => [
        c.name,
        formatPhone(c.phone),
        String(c.numberOfOrders),
        formatCurrencyBRL(c.totalSpent),
        formatCurrencyBRL(c.averageTicket),
        formatOrderDateTime(c.lastOrderAt),
      ]),
    ];
    downloadCsv("clientes.csv", rows);
  }

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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Clientes cadastrados" value={stats.totalCustomers} />
        <StatTile label="Novos este mês" value={stats.newThisMonth} />
        <StatTile label="Recorrentes" value={`${stats.recurring} (${stats.recurringPercent.toFixed(1)}%)`} />
        <StatTile label="Ticket médio" value={formatCurrencyBRL(stats.averageTicket)} />
        <StatTile label="Pedidos totais" value={stats.totalOrders} />
      </div>

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou telefone"
            className="h-10 w-full max-w-sm rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
          />
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors ${
                  tab === t.id ? "bg-primary text-white" : "text-text-muted hover:bg-surface-subdued"
                }`}
              >
                {t.label} ({tabCounts[t.id]})
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={handleExport}
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-card px-3.5 text-sm font-semibold text-graphite hover:bg-surface-subdued"
        >
          Exportar clientes
        </button>
      </div>

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
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3.5 py-8 text-center text-sm text-text-muted">
                  Nenhum cliente encontrado para essa busca/filtro.
                </td>
              </tr>
            ) : (
              filtered.map((customer) => (
                <Fragment key={customer.phone}>
                  <tr
                    onClick={() => setExpandedPhone((prev) => (prev === customer.phone ? null : customer.phone))}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-subdued"
                  >
                    <td className="px-3.5 py-2.5">
                      <p className="font-bold text-graphite">{customer.name}</p>
                      <p className="text-[11px] font-medium text-text-muted">Convidado</p>
                    </td>
                    <td className="px-3.5 py-2.5 text-text-muted">{formatPhone(customer.phone)}</td>
                    <td className="px-3.5 py-2.5 text-right text-graphite">{customer.numberOfOrders}</td>
                    <td className="px-3.5 py-2.5 text-right font-bold text-graphite">{formatCurrencyBRL(customer.totalSpent)}</td>
                    <td className="px-3.5 py-2.5 text-right text-graphite">{formatCurrencyBRL(customer.averageTicket)}</td>
                    <td className="px-3.5 py-2.5 text-text-muted">{formatOrderDateTime(customer.lastOrderAt)}</td>
                  </tr>
                  {expandedPhone === customer.phone && (
                    <tr className="border-b border-border bg-surface-subdued/50">
                      <td colSpan={6} className="px-3.5 py-3">
                        <div className="mb-3 flex flex-wrap gap-2">
                          <a
                            href={`https://wa.me/55${customer.phone}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-8 items-center rounded-lg bg-emerald px-3 text-xs font-semibold text-white hover:opacity-90"
                          >
                            WhatsApp
                          </a>
                          <a
                            href={`tel:+55${customer.phone}`}
                            className="inline-flex h-8 items-center rounded-lg border border-border bg-surface-card px-3 text-xs font-semibold text-graphite hover:bg-surface-subdued"
                          >
                            Ligar
                          </a>
                        </div>

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

                        <NotesSection phone={customer.phone} notes={notesByPhone[customer.phone] ?? []} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
