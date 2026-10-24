"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Modal } from "@/components/ui/Modal";
import {
  createPromotionAction,
  deletePromotionAction,
  togglePromotionActiveAction,
  updatePromotionAction,
} from "@/lib/actions/promotions";
import { formatCurrencyBRL } from "@/lib/products";
import { describeDiscount, describeSchedule, promotionStatus, type Promotion } from "@/lib/promotions";
import { PromotionFormFields } from "./PromotionFormFields";

const STATUS_BADGE: Record<ReturnType<typeof promotionStatus>, { label: string; className: string }> = {
  on: { label: "No ar", className: "bg-emerald/10 text-emerald" },
  scheduled: { label: "Agendada", className: "bg-amber/15 text-amber-strong" },
  ended: { label: "Encerrada", className: "bg-surface-subdued text-text-muted" },
  off: { label: "Desligada", className: "bg-surface-subdued text-text-muted" },
};

/**
 * Promoções automáticas (v1): desconto em % ou R$ sobre o subtotal, aplicado sozinho no checkout, na sacola
 * e na Frente de Caixa quando pedido mínimo, período, dias e horário valem. Não acumula com cupom — vale o
 * maior desconto. create_order recalcula tudo no servidor; a tela do cliente só mostra a prévia.
 */
export function PromotionsManager({ initialPromotions }: { initialPromotions: Promotion[] }) {
  const [promotions, setPromotions] = useState(initialPromotions);
  const [syncedInitial, setSyncedInitial] = useState(initialPromotions);
  if (initialPromotions !== syncedInitial) {
    setSyncedInitial(initialPromotions);
    setPromotions(initialPromotions);
  }

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [deleting, setDeleting] = useState<Promotion | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleToggle(promotion: Promotion) {
    setRowError(null);
    setPendingId(promotion.id);
    startTransition(async () => {
      const result = await togglePromotionActiveAction(promotion.id, !promotion.is_active);
      setPendingId(null);
      if (!result.ok) setRowError(result.error ?? "Não foi possível atualizar.");
    });
  }

  function handleConfirmDelete() {
    if (!deleting) return;
    setDeleteError(null);
    setPendingId(deleting.id);
    startTransition(async () => {
      const result = await deletePromotionAction(deleting.id);
      setPendingId(null);
      if (!result.ok) {
        setDeleteError(result.error ?? "Não foi possível excluir.");
        return;
      }
      setDeleting(null);
    });
  }

  return (
    <Card className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-body-lg font-bold uppercase tracking-wide text-text-muted">Promoções automáticas</h2>
          <p className="mt-1 text-body-md text-text-muted">
            O desconto entra sozinho no checkout quando as condições valem. Não acumula com cupom: vale o maior.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="shrink-0">
          <span className="text-headline-sm leading-none">+</span>
          Nova promoção
        </Button>
      </div>

      {rowError && <ErrorState message={rowError} />}

      {promotions.length === 0 ? (
        <EmptyState
          title="Nenhuma promoção cadastrada ainda."
          description="Crie, por exemplo, 10% de desconto nas sextas à noite para pedidos acima de R$ 50."
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {promotions.map((promotion) => {
            const isRowPending = isPending && pendingId === promotion.id;
            const status = STATUS_BADGE[promotionStatus(promotion)];
            return (
              <li key={promotion.id} className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body-md font-bold text-graphite">{promotion.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-label-sm font-bold ${status.className}`}>{status.label}</span>
                  </div>
                  <p className="mt-0.5 text-body-sm text-text-muted">
                    <span className="font-bold text-graphite">{describeDiscount(promotion)}</span>
                    {promotion.min_order_value !== null && <> · acima de {formatCurrencyBRL(promotion.min_order_value)}</>}
                    {" · "}
                    {describeSchedule(promotion)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={promotion.is_active}
                    aria-label={promotion.is_active ? `Desligar ${promotion.name}` : `Ligar ${promotion.name}`}
                    disabled={isRowPending}
                    onClick={() => handleToggle(promotion)}
                    className={`relative h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${
                      promotion.is_active ? "bg-emerald" : "bg-surface-subdued"
                    }`}
                    title={promotion.is_active ? "Ligada" : "Desligada"}
                  >
                    <span
                      className={`pointer-events-none block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                        promotion.is_active ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(promotion)}
                    className="rounded-lg px-2.5 py-1.5 text-label-md text-graphite hover:bg-primary/10 hover:text-primary"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleting(promotion);
                    }}
                    className="rounded-lg px-2.5 py-1.5 text-label-md text-red hover:bg-red/10"
                  >
                    Excluir
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nova promoção">
        <PromotionFormFields action={createPromotionAction} submitLabel="Criar promoção" onSuccess={() => setCreateOpen(false)} />
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Editar promoção">
        {editing && (
          <PromotionFormFields action={updatePromotionAction} promotion={editing} submitLabel="Salvar alterações" onSuccess={() => setEditing(null)} />
        )}
      </Modal>

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title="Excluir promoção?">
        <div className="space-y-4">
          <p className="text-body-md text-text-muted">
            Tem certeza que deseja excluir <span className="font-semibold text-graphite">{deleting?.name}</span>? Ela deixa de valer
            imediatamente. Os pedidos que já usaram a promoção continuam com o desconto registrado.
          </p>
          {deleteError && <ErrorState message={deleteError} />}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={isPending}>
              Cancelar
            </Button>
            <button
              type="button"
              onClick={handleConfirmDelete}
              disabled={isPending}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-red px-5 text-label-lg text-white transition-all duration-150 hover:bg-red/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending && pendingId === deleting?.id && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              )}
              Excluir
            </button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
