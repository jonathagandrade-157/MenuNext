"use client";

import { useMemo, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Modal } from "@/components/ui/Modal";
import { recordStockMovementAction, setStockAutoDeductAction, setStockThresholdAction } from "@/lib/actions/stock";
import {
  STOCK_KINDS,
  STOCK_KIND_LABELS,
  STOCK_NOTE_MAX_LENGTH,
  STOCK_STATUS_LABELS,
  summarizeStock,
  type ManualStockKind,
  type StockMovementRow,
  type StockRow,
} from "@/lib/stock";

type Filter = "all" | "alert" | "untracked";

const INPUT =
  "h-11 w-full rounded-xl border border-border bg-surface px-3 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

function statusTone(status: StockRow["status"]) {
  if (status === "out") return "danger" as const;
  if (status === "low") return "warning" as const;
  if (status === "ok") return "success" as const;
  return "neutral" as const;
}

function formatWhen(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function EstoqueClient({ rows, movements, autoDeduct }: { rows: StockRow[]; movements: StockMovementRow[]; autoDeduct: boolean | null }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [moving, setMoving] = useState<StockRow | null>(null);
  const [limiting, setLimiting] = useState<StockRow | null>(null);
  const [kind, setKind] = useState<ManualStockKind>("entry");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [threshold, setThreshold] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const summary = useMemo(() => summarizeStock(rows), [rows]);
  const untracked = rows.length - summary.tracked;

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === "alert" && row.status !== "low" && row.status !== "out") return false;
      if (filter === "untracked" && row.tracked) return false;
      return !query || row.name.toLowerCase().includes(query);
    });
  }, [rows, search, filter]);

  function openMove(row: StockRow) {
    setMoving(row);
    setKind(row.tracked ? "entry" : "adjustment");
    setQuantity("");
    setNote("");
    setError(null);
  }

  function openLimit(row: StockRow) {
    setLimiting(row);
    setThreshold(row.tracked ? String(row.lowThreshold) : "0");
    setError(null);
  }

  function submitMove() {
    if (!moving) return;
    setError(null);
    startTransition(async () => {
      const result = await recordStockMovementAction(moving.productId, kind, quantity, note);
      if (!result.ok) return setError(result.error);
      setMoving(null);
    });
  }

  function submitLimit() {
    if (!limiting) return;
    setError(null);
    startTransition(async () => {
      const result = await setStockThresholdAction(limiting.productId, threshold);
      if (!result.ok) return setError(result.error);
      setLimiting(null);
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <nav className="flex items-center gap-2 text-label-md text-text-muted">
        <span>Painel</span>
        <span>/</span>
        <span>Cardápio</span>
        <span>/</span>
        <span className="text-graphite">Estoque</span>
      </nav>

      <div>
        <h1 className="text-headline-lg text-graphite">Estoque</h1>
        <p className="mt-0.5 text-body-md text-text-muted">
          Registre entradas, saídas, perdas e contagens e receba o alerta de estoque baixo.
        </p>
      </div>

      <Card className="border-amber/30 bg-amber/5 p-4 text-body-md text-graphite">
        {autoDeduct
          ? "A baixa automática está LIGADA: cada item vendido (a partir de quando você ligou) sai do saldo e o cancelamento devolve. O estoque nunca bloqueia um pedido; a venda acima do saldo zera o produto."
          : "O estoque é um controle interno: ele não baixa sozinho com as vendas e não impede pedidos. Para tirar um produto do ar, use a disponibilidade em Produtos."}
        {autoDeduct !== null && (
          <div className="mt-3">
            <Button
              size="sm"
              variant="secondary"
              disabled={isPending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await setStockAutoDeductAction(!autoDeduct);
                  if (!result.ok) setError(result.error);
                });
              }}
            >
              {autoDeduct ? "Desligar baixa automática" : "Ligar baixa automática"}
            </Button>
          </div>
        )}
        {error && !moving && !limiting && <div className="mt-3"><ErrorState message={error} /></div>}
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-label-md text-text-muted">Produtos controlados</p>
          <p className="mt-1 text-headline-md text-graphite">{summary.tracked}</p>
        </Card>
        <Card className="p-4">
          <p className="text-label-md text-text-muted">Estoque baixo</p>
          <p className="mt-1 text-headline-md text-amber-strong">{summary.low}</p>
        </Card>
        <Card className="p-4">
          <p className="text-label-md text-text-muted">Sem estoque</p>
          <p className="mt-1 text-headline-md text-red">{summary.out}</p>
        </Card>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Você ainda não possui produtos." description="Cadastre produtos em Cardápio › Produtos para controlar o estoque." />
      ) : (
        <>
          <Card className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center">
            <div className="relative w-full max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar produto..."
                aria-label="Buscar produto"
                className={`${INPUT} h-10 pl-9`}
              />
            </div>
            <div className="flex items-center gap-1 overflow-x-auto rounded-xl bg-surface-subdued p-1">
              {(
                [
                  ["all", `Todos (${rows.length})`],
                  ["alert", `Alertas (${summary.low + summary.out})`],
                  ["untracked", `Sem controle (${untracked})`],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-label-md transition-colors ${
                    filter === value ? "bg-surface-card text-graphite shadow-card" : "text-text-muted hover:text-graphite"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            {visible.length === 0 ? (
              <p className="px-5 py-8 text-center text-body-md text-text-muted">Nenhum produto encontrado para essa busca/filtro.</p>
            ) : (
              <ul className="divide-y divide-border">
                {visible.map((row) => (
                  <li key={row.productId} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-graphite">{row.name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {row.status !== "untracked" ? (
                          <Badge tone={statusTone(row.status)}>{STOCK_STATUS_LABELS[row.status]}</Badge>
                        ) : (
                          <Badge tone="neutral">Sem controle</Badge>
                        )}
                        {row.tracked && row.lowThreshold > 0 && (
                          <span className="text-body-sm text-text-muted">alerta em {row.lowThreshold}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <p className="text-headline-sm text-graphite" aria-label="Saldo">
                        {row.tracked ? row.quantity : "—"}
                      </p>
                      <Button size="sm" variant="secondary" onClick={() => openLimit(row)}>
                        Alerta
                      </Button>
                      <Button size="sm" onClick={() => openMove(row)}>
                        Movimentar
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <section aria-labelledby="historico-estoque" className="space-y-3">
            <h2 id="historico-estoque" className="text-headline-sm text-graphite">
              Últimas movimentações
            </h2>
            {movements.length === 0 ? (
              <p className="text-body-md text-text-muted">Nenhuma movimentação registrada ainda.</p>
            ) : (
              <Card className="overflow-hidden p-0">
                <ul className="divide-y divide-border">
                  {movements.map((m) => (
                    <li key={m.id} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
                      <div className="min-w-0">
                        <p className="truncate text-body-md font-medium text-graphite">{m.productName}</p>
                        <p className="text-body-sm text-text-muted">
                          {STOCK_KIND_LABELS[m.kind]} · {formatWhen(m.createdAt)}
                          {m.note ? ` · ${m.note}` : ""}
                        </p>
                      </div>
                      <p className="shrink-0 text-right text-body-md text-graphite">
                        <span className={m.delta > 0 ? "font-semibold text-emerald" : "font-semibold text-red"}>
                          {m.delta > 0 ? `+${m.delta}` : m.delta}
                        </span>
                        <span className="block text-body-sm text-text-muted">saldo {m.balanceAfter}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>
        </>
      )}

      <Modal open={moving !== null} onClose={() => setMoving(null)} title={moving ? `Movimentar — ${moving.name}` : "Movimentar"}>
        <div className="space-y-4">
          {moving && (
            <p className="text-body-md text-text-muted">
              Saldo atual: <strong className="text-graphite">{moving.tracked ? moving.quantity : 0}</strong>
            </p>
          )}
          <label className="block space-y-1">
            <span className="text-label-md text-graphite">Tipo</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as ManualStockKind)} className={INPUT}>
              {STOCK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {STOCK_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-label-md text-graphite">{kind === "adjustment" ? "Saldo contado" : "Quantidade"}</span>
            <input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" className={INPUT} />
          </label>
          <label className="block space-y-1">
            <span className="text-label-md text-graphite">Observação (opcional)</span>
            <input value={note} maxLength={STOCK_NOTE_MAX_LENGTH} onChange={(e) => setNote(e.target.value)} className={INPUT} />
          </label>
          {error && <ErrorState message={error} />}
          <Button className="w-full" onClick={submitMove} loading={isPending} disabled={isPending}>
            {isPending ? "Salvando..." : "Registrar"}
          </Button>
        </div>
      </Modal>

      <Modal open={limiting !== null} onClose={() => setLimiting(null)} title={limiting ? `Alerta — ${limiting.name}` : "Alerta"}>
        <div className="space-y-4">
          <p className="text-body-md text-text-muted">
            Avisar quando o saldo chegar a este número ou menos. Use 0 para desligar o alerta de estoque baixo (o aviso de
            &quot;sem estoque&quot; continua).
          </p>
          <label className="block space-y-1">
            <span className="text-label-md text-graphite">Limite do alerta</span>
            <input inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} className={INPUT} />
          </label>
          {error && <ErrorState message={error} />}
          <Button className="w-full" onClick={submitLimit} loading={isPending} disabled={isPending}>
            {isPending ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
