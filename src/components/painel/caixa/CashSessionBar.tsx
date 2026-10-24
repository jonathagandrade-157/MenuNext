"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, LockOpen } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import { parseMoneyInput } from "@/lib/products";
import { openCashAction, closeCashAction } from "@/lib/actions/cashSession";
import {
  describeCashDifference,
  formatCashTime,
  type CashClosing,
  type CashDifference,
  type CashSession,
} from "@/lib/cash";
import { formatCurrencyBRL } from "@/lib/store";

const INPUT =
  "h-11 w-full rounded-xl border border-border bg-surface-card px-3.5 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

const DIFFERENCE_STYLE: Record<CashDifference["kind"], string> = {
  ok: "border-emerald/30 bg-emerald/10 text-emerald",
  over: "border-amber/40 bg-amber/10 text-amber-strong",
  short: "border-red/30 bg-red/10 text-red",
};

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${strong ? "font-bold text-graphite" : "text-text-muted"}`}>
      <span>{label}</span>
      <span className={strong ? "" : "font-semibold text-graphite"}>{value}</span>
    </div>
  );
}

/**
 * Estado do caixa no topo da Frente de Caixa. Fechado: convida a abrir (a venda fica bloqueada, na tela e na
 * Server Action). Aberto: resumo ao vivo e o botão de fechar, que pede o dinheiro contado e mostra a diferença
 * antes de confirmar. Quem opera é o STAFF ou o OWNER — as RPCs derivam a loja do usuário logado.
 */
export function CashSessionBar({ session }: { session: CashSession | null }) {
  const router = useRouter();

  const [openDialog, setOpenDialog] = useState(false);
  const [openingInput, setOpeningInput] = useState("");

  const [closeDialog, setCloseDialog] = useState(false);
  const [countedInput, setCountedInput] = useState("");
  const [notes, setNotes] = useState("");
  const [closing, setClosing] = useState<CashClosing | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const counted = countedInput.trim() ? parseMoneyInput(countedInput) : null;
  const previewDifference = session && counted !== null ? describeCashDifference(counted - session.expectedCash) : null;

  async function handleOpen() {
    setError(null);
    setBusy(true);
    const result = await openCashAction(openingInput.trim() ? parseMoneyInput(openingInput) : 0);
    setBusy(false);
    if (result.status === "error") {
      setError(result.message);
      return;
    }
    setOpenDialog(false);
    setOpeningInput("");
    router.refresh();
  }

  async function handleClose() {
    setError(null);
    setBusy(true);
    const result = await closeCashAction(counted, notes);
    setBusy(false);
    if (result.status === "error") {
      setError(result.message);
      return;
    }
    setClosing(result.closing);
    router.refresh();
  }

  function dismissClose() {
    setCloseDialog(false);
    setClosing(null);
    setCountedInput("");
    setNotes("");
    setError(null);
  }

  const closingDifference = closing ? describeCashDifference(closing.difference) : null;

  return (
    <>
      {session ? (
        <div className="rounded-2xl border border-emerald/30 bg-emerald/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald/15 text-emerald">
                <LockOpen className="h-4.5 w-4.5" aria-hidden />
              </span>
              <div>
                <p className="text-label-lg font-bold text-graphite">Caixa aberto</p>
                <p className="text-body-sm text-text-muted">
                  desde {formatCashTime(session.openedAt)} · {session.openedByName}
                </p>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setCloseDialog(true)}>
              <Lock className="h-4 w-4" aria-hidden /> Fechar caixa
            </Button>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Fundo inicial", value: formatCurrencyBRL(session.openingAmount) },
              { label: `Vendas (${session.ordersCount})`, value: formatCurrencyBRL(session.totalSales) },
              { label: "Em dinheiro", value: formatCurrencyBRL(session.cashSales) },
              { label: "Dinheiro esperado", value: formatCurrencyBRL(session.expectedCash) },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-border bg-surface-card px-3 py-2">
                <dt className="text-body-sm text-text-muted">{item.label}</dt>
                <dd className="text-label-lg font-bold text-graphite">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber/40 bg-amber/10 p-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber/20 text-amber-strong">
              <Lock className="h-4.5 w-4.5" aria-hidden />
            </span>
            <div>
              <p className="text-label-lg font-bold text-graphite">Caixa fechado</p>
              <p className="text-body-sm text-text-muted">Abra o caixa, informando o dinheiro que já está na gaveta, para registrar vendas.</p>
            </div>
          </div>
          <Button
            onClick={() => {
              setError(null);
              setOpenDialog(true);
            }}
          >
            <LockOpen className="h-4 w-4" aria-hidden /> Abrir caixa
          </Button>
        </div>
      )}

      <Modal open={openDialog} onClose={() => !busy && setOpenDialog(false)} title="Abrir caixa">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleOpen();
          }}
        >
          <label className="block space-y-1.5">
            <span className="text-label-md font-bold text-graphite">Dinheiro na gaveta (fundo de troco)</span>
            <input
              autoFocus
              value={openingInput}
              onChange={(e) => setOpeningInput(e.target.value)}
              placeholder="0,00"
              inputMode="decimal"
              className={INPUT}
            />
            <span className="block text-body-sm text-text-muted">Deixe em branco se a gaveta está vazia.</span>
          </label>
          {error && <ErrorState message={error} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpenDialog(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button type="submit" loading={busy}>
              Abrir caixa
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={closeDialog} onClose={() => !busy && dismissClose()} title={closing ? "Caixa fechado" : "Fechar caixa"}>
        {closing && closingDifference ? (
          <div className="space-y-4">
            <div className={`rounded-xl border px-3.5 py-3 text-center text-label-lg font-bold ${DIFFERENCE_STYLE[closingDifference.kind]}`}>
              {closingDifference.label}
            </div>
            <div className="space-y-1.5 text-body-md">
              <Row label="Fundo inicial" value={formatCurrencyBRL(closing.openingAmount)} />
              <Row label={`Vendas (${closing.ordersCount})`} value={formatCurrencyBRL(closing.totalSales)} />
              <Row label="· Dinheiro" value={formatCurrencyBRL(closing.cashSales)} />
              <Row label="· Pix" value={formatCurrencyBRL(closing.pixSales)} />
              <Row label="· Cartão" value={formatCurrencyBRL(closing.cardSales)} />
              <div className="border-t border-border pt-1.5">
                <Row label="Dinheiro esperado" value={formatCurrencyBRL(closing.expectedCash)} />
                <Row label="Dinheiro contado" value={formatCurrencyBRL(closing.countedCash)} strong />
              </div>
            </div>
            <Button className="w-full" onClick={dismissClose}>
              Concluir
            </Button>
          </div>
        ) : (
          session && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void handleClose();
              }}
            >
              <div className="space-y-1.5 text-body-md">
                <Row label="Fundo inicial" value={formatCurrencyBRL(session.openingAmount)} />
                <Row label={`Vendas (${session.ordersCount})`} value={formatCurrencyBRL(session.totalSales)} />
                <Row label="· Dinheiro" value={formatCurrencyBRL(session.cashSales)} />
                <Row label="· Pix" value={formatCurrencyBRL(session.pixSales)} />
                <Row label="· Cartão" value={formatCurrencyBRL(session.cardSales)} />
                <div className="border-t border-border pt-1.5">
                  <Row label="Dinheiro esperado na gaveta" value={formatCurrencyBRL(session.expectedCash)} strong />
                </div>
              </div>

              <label className="block space-y-1.5">
                <span className="text-label-md font-bold text-graphite">Dinheiro contado na gaveta</span>
                <input
                  autoFocus
                  value={countedInput}
                  onChange={(e) => setCountedInput(e.target.value)}
                  placeholder="0,00"
                  inputMode="decimal"
                  className={INPUT}
                />
              </label>

              {previewDifference && (
                <div className={`rounded-xl border px-3.5 py-2 text-center text-label-md font-bold ${DIFFERENCE_STYLE[previewDifference.kind]}`}>
                  {previewDifference.label}
                </div>
              )}

              <label className="block space-y-1.5">
                <span className="text-label-md font-bold text-graphite">Observação (opcional)</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  maxLength={300}
                  placeholder="Ex.: sangria de R$ 100 para o banco"
                  className="w-full rounded-xl border border-border bg-surface-card px-3.5 py-2 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
                />
              </label>

              {error && <ErrorState message={error} />}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={dismissClose} disabled={busy}>
                  Cancelar
                </Button>
                <Button type="submit" loading={busy} disabled={counted === null}>
                  Fechar caixa
                </Button>
              </div>
            </form>
          )
        )}
      </Modal>
    </>
  );
}
