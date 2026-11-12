"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/States";
import { parseMoneyInput } from "@/lib/products";
import { recordCashMovementAction } from "@/lib/actions/cashSession";
import { CASH_MOVEMENT_LABELS, CASH_REASON_MAX_LENGTH, formatCashTime, type CashMovement, type CashMovementKind } from "@/lib/cash";
import { formatCurrencyBRL } from "@/lib/store";

const INPUT =
  "h-11 w-full rounded-xl border border-border bg-surface-card px-3.5 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

/** Suprimentos e sangrias da sessão aberta. Só aparece com o caixa aberto e a migration aplicada. */
export function CashMovements({ rows }: { rows: CashMovement[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<CashMovementKind | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function open(next: CashMovementKind) {
    setKind(next);
    setAmount("");
    setReason("");
    setError(null);
  }

  function submit() {
    if (!kind) return;
    setError(null);
    startTransition(async () => {
      const result = await recordCashMovementAction(kind, parseMoneyInput(amount), reason);
      if (result.status === "error") return setError(result.message);
      setKind(null);
      router.refresh();
    });
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-headline-sm text-graphite">Movimentações do caixa</h2>
          <p className="text-body-sm text-text-muted">Suprimento coloca dinheiro no caixa; sangria retira. Ambos entram no dinheiro esperado.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => open("supply")}>Suprimento</Button>
          <Button size="sm" variant="secondary" onClick={() => open("withdrawal")}>Sangria</Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-body-md text-text-muted">Nenhuma movimentação nesta sessão.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-body-md text-graphite">{m.reason}</p>
                <p className="text-body-sm text-text-muted">{CASH_MOVEMENT_LABELS[m.kind]} · {m.createdByName} · {formatCashTime(m.createdAt)}</p>
              </div>
              <span className={`shrink-0 font-semibold ${m.kind === "supply" ? "text-emerald" : "text-red"}`}>
                {m.kind === "supply" ? "+" : "−"}{formatCurrencyBRL(m.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Modal open={kind !== null} onClose={() => setKind(null)} title={kind ? CASH_MOVEMENT_LABELS[kind] : "Movimentação"}>
        <div className="space-y-4">
          <label className="block space-y-1">
            <span className="text-label-md text-graphite">Valor (R$)</span>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" className={INPUT} />
          </label>
          <label className="block space-y-1">
            <span className="text-label-md text-graphite">Motivo</span>
            <input value={reason} maxLength={CASH_REASON_MAX_LENGTH} onChange={(e) => setReason(e.target.value)} placeholder={kind === "withdrawal" ? "Ex.: sangria ao cofre" : "Ex.: reforço de troco"} className={INPUT} />
          </label>
          {error && <ErrorState message={error} />}
          <Button className="w-full" onClick={submit} loading={pending} disabled={pending}>{pending ? "Salvando..." : "Registrar"}</Button>
        </div>
      </Modal>
    </Card>
  );
}
