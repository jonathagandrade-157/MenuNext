"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Download, MessageCircle, Phone, Receipt, Repeat, Search, ShoppingBag, TrendingUp, Users, type LucideIcon } from "lucide-react";
import { StatusBadge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Drawer } from "@/components/ui/Drawer";
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

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
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

function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tint,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  tint: string;
}) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tint}`}>
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="truncate text-label-sm uppercase text-text-muted">{label}</p>
        <p className="text-headline-md text-graphite">{value}</p>
        {hint && <p className="text-body-sm text-text-muted">{hint}</p>}
      </div>
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

const SEGMENT_CHIP: Record<CustomerSegment, { label: string; className: string }> = {
  recorrente: { label: "Recorrente", className: "bg-emerald/10 text-emerald" },
  novo: { label: "Novo", className: "bg-primary/10 text-primary" },
  inativo: { label: "Inativo", className: "bg-surface-subdued text-text-muted" },
};

function SegmentChips({ segments }: { segments: CustomerSegment[] }) {
  return (
    <>
      {segments.map((segment) => (
        <span key={segment} className={`rounded-full px-2 py-0.5 text-label-sm ${SEGMENT_CHIP[segment].className}`}>
          {SEGMENT_CHIP[segment].label}
        </span>
      ))}
    </>
  );
}

function NotesSection({ phone, notes }: { phone: string; notes: CustomerNote[] }) {
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
    <div>
      <p className="mb-1.5 text-label-sm uppercase text-text-muted">
        Observações internas <span className="font-normal normal-case">(visível apenas para a equipe)</span>
      </p>
      {notes.length > 0 && (
        <div className="mb-2 space-y-1.5">
          {notes.map((noteRow) => (
            <div key={noteRow.id} className="rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-body-md text-graphite">
              {noteRow.note}
              <span className="ml-2 text-body-sm text-text-muted">{formatOrderDateTime(noteRow.created_at)}</span>
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
          className="h-10 w-full rounded-xl border border-border bg-surface-card px-3 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending || !draft.trim()}
          className="shrink-0 rounded-xl bg-primary px-4 text-label-lg text-white transition-all hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </div>
  );
}

function CustomerDetail({
  customer,
  segments,
  notes,
}: {
  customer: CustomerSummary;
  segments: CustomerSegment[];
  notes: CustomerNote[];
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <SegmentChips segments={segments} />
        <span className="rounded-full bg-surface-subdued px-2 py-0.5 text-label-sm text-text-muted">Pedido como convidado</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <a
          href={`https://wa.me/55${customer.phone}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-emerald/10 text-label-lg text-emerald hover:bg-emerald/20"
        >
          <MessageCircle className="h-4 w-4" aria-hidden />
          WhatsApp
        </a>
        <a
          href={`tel:+55${customer.phone}`}
          className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface-card text-label-lg text-graphite hover:bg-surface-subdued"
        >
          <Phone className="h-4 w-4" aria-hidden />
          Ligar
        </a>
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-xl bg-surface-subdued p-3">
        <div>
          <p className="text-label-sm uppercase text-text-muted">Total gasto</p>
          <p className="text-body-lg font-bold text-graphite">{formatCurrencyBRL(customer.totalSpent)}</p>
        </div>
        <div>
          <p className="text-label-sm uppercase text-text-muted">Pedidos</p>
          <p className="text-body-lg font-bold text-primary">{customer.numberOfOrders}</p>
        </div>
        <div>
          <p className="text-label-sm uppercase text-text-muted">Ticket médio</p>
          <p className="text-body-lg font-bold text-graphite">{formatCurrencyBRL(customer.averageTicket)}</p>
        </div>
      </div>

      {customer.addresses.length > 0 && (
        <div>
          <p className="mb-1.5 text-label-sm uppercase text-text-muted">Endereços usados</p>
          <div className="space-y-1.5">
            {customer.addresses.map((address) => (
              <p key={address} className="rounded-lg border border-border px-3 py-2 text-body-md text-graphite">
                {address}
              </p>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-label-sm uppercase text-text-muted">Histórico de pedidos</p>
        <div className="space-y-2">
          {customer.orders.map((order) => (
            <Link
              key={order.id}
              href={`/painel/pedidos?order=${order.id}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-body-md hover:bg-surface-subdued"
            >
              <span>
                <span className="font-bold text-primary">#{order.orderNumber}</span>
                <span className="ml-2 text-body-sm text-text-muted">{formatOrderDateTime(order.createdAt)}</span>
              </span>
              <span className="flex items-center gap-2">
                <StatusBadge status={order.status} />
                <span className="font-bold text-graphite">{formatCurrencyBRL(order.total)}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>

      <NotesSection phone={customer.phone} notes={notes} />

      <p className="text-body-sm text-text-muted">
        Dados usados apenas para atender pedidos e se comunicar sobre eles, conforme a LGPD.
      </p>
    </div>
  );
}

/**
 * Base de clientes (Fase 4.1, redesign Stitch) — agregação pura de `orders`
 * (aggregateCustomers em lib/customers.ts), nunca um CRM: busca por
 * nome/telefone, segmentação (recorrente/novo/inativo — ver
 * getCustomerSegments) e um painel de detalhe (gaveta) com histórico,
 * endereços e observações internas por cliente (customer_notes).
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
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);

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

  const selected = selectedPhone ? (customers.find((c) => c.phone === selectedPhone) ?? null) : null;

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
        <p className="text-body-lg font-bold text-graphite">Nenhum cliente ainda</p>
        <p className="mt-1 text-body-md text-text-muted">Assim que você receber o primeiro pedido, o cliente aparece aqui.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Clientes" value={stats.totalCustomers} icon={Users} tint="bg-primary/10 text-primary" />
        <StatTile label="Novos este mês" value={stats.newThisMonth} icon={TrendingUp} tint="bg-primary/10 text-primary" />
        <StatTile
          label="Recorrentes"
          value={stats.recurring}
          hint={`${stats.recurringPercent.toFixed(1)}% da base`}
          icon={Repeat}
          tint="bg-emerald/10 text-emerald"
        />
        <StatTile label="Ticket médio" value={formatCurrencyBRL(stats.averageTicket)} icon={Receipt} tint="bg-blue/10 text-blue" />
        <StatTile label="Pedidos totais" value={stats.totalOrders} icon={ShoppingBag} tint="bg-amber/10 text-amber" />
      </div>

      <Card className="flex flex-col justify-between gap-3 p-3.5 lg:flex-row lg:items-center">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou telefone"
              className="h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
            />
          </div>
          <div className="flex items-center gap-1 overflow-x-auto rounded-xl bg-surface-subdued p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-label-md transition-colors ${
                  tab === t.id ? "bg-surface-card text-graphite shadow-card" : "text-text-muted hover:text-graphite"
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
          className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface-card px-3.5 text-label-lg text-graphite hover:bg-surface-subdued"
        >
          <Download className="h-4 w-4" aria-hidden />
          Exportar clientes
        </button>
      </Card>

      {filtered.length === 0 ? (
        <Card className="p-8 text-center text-body-md text-text-muted">Nenhum cliente encontrado para essa busca/filtro.</Card>
      ) : (
        <>
          {/* Celular: cartões. */}
          <div className="space-y-2 md:hidden">
            {filtered.map((customer) => (
              <button
                key={customer.phone}
                type="button"
                onClick={() => setSelectedPhone(customer.phone)}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface-card p-3 text-left shadow-card"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-label-md text-primary">
                  {initials(customer.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-md font-bold text-graphite">{customer.name}</span>
                  <span className="block text-body-sm text-text-muted">{formatPhone(customer.phone)}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <SegmentChips segments={segmentsByPhone.get(customer.phone) ?? []} />
                  </span>
                </span>
                <span className="text-right">
                  <span className="block text-body-md font-bold text-graphite">{formatCurrencyBRL(customer.totalSpent)}</span>
                  <span className="block text-body-sm text-text-muted">{customer.numberOfOrders} pedidos</span>
                </span>
              </button>
            ))}
          </div>

          {/* Tablet e desktop: tabela. */}
          <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface-card md:block">
            <table className="w-full min-w-[720px] text-body-md">
              <thead>
                <tr className="border-b border-border text-left text-label-sm uppercase text-text-muted">
                  <th className="px-3.5 py-3">Cliente</th>
                  <th className="px-3.5 py-3">Contato</th>
                  <th className="px-3.5 py-3 text-right">Pedidos</th>
                  <th className="px-3.5 py-3 text-right">Total gasto</th>
                  <th className="px-3.5 py-3 text-right">Ticket médio</th>
                  <th className="px-3.5 py-3">Último pedido</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((customer) => (
                  <tr
                    key={customer.phone}
                    onClick={() => setSelectedPhone(customer.phone)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-subdued"
                  >
                    <td className="px-3.5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-label-md text-primary">
                          {initials(customer.name)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-bold text-graphite">{customer.name}</p>
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            <SegmentChips segments={segmentsByPhone.get(customer.phone) ?? []} />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3.5 py-3 text-text-muted">{formatPhone(customer.phone)}</td>
                    <td className="px-3.5 py-3 text-right text-graphite">{customer.numberOfOrders}</td>
                    <td className="px-3.5 py-3 text-right font-bold text-graphite">{formatCurrencyBRL(customer.totalSpent)}</td>
                    <td className="px-3.5 py-3 text-right text-graphite">{formatCurrencyBRL(customer.averageTicket)}</td>
                    <td className="px-3.5 py-3 text-text-muted">{formatOrderDateTime(customer.lastOrderAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-body-sm text-text-muted">
            Mostrando {filtered.length} de {customers.length} clientes
          </p>
        </>
      )}

      <Drawer
        open={selected !== null}
        onClose={() => setSelectedPhone(null)}
        title={selected?.name ?? ""}
        subtitle={selected ? `${formatPhone(selected.phone)} · cliente desde ${formatOrderDateTime(selected.orders[selected.orders.length - 1]?.createdAt ?? selected.lastOrderAt)}` : undefined}
      >
        {selected && (
          <CustomerDetail
            customer={selected}
            segments={segmentsByPhone.get(selected.phone) ?? []}
            notes={notesByPhone[selected.phone] ?? []}
          />
        )}
      </Drawer>
    </div>
  );
}
