"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Modal } from "@/components/ui/Modal";
import { createPlanAction, deletePlanAction, togglePlanActiveAction, updatePlanAction } from "@/lib/actions/plans";
import { formatCurrencyBRL } from "@/lib/products";
import type { Plan } from "@/lib/tenant";
import { PlanFormFields } from "./PlanFormFields";

/** CRUD de planos (área "Assinaturas" do Master) — nome/preço são dados
 * reais cadastrados aqui pelo próprio MenuNext, nunca valores de exemplo.
 * Mesmo padrão visual de CouponsManager/DeliveryZonesManager. */
export function PlansManager({ initialPlans }: { initialPlans: Plan[] }) {
  const [plans, setPlans] = useState(initialPlans);
  const [syncedInitial, setSyncedInitial] = useState(initialPlans);
  if (initialPlans !== syncedInitial) {
    setSyncedInitial(initialPlans);
    setPlans(initialPlans);
  }

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [deleting, setDeleting] = useState<Plan | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleToggle(plan: Plan) {
    setRowError(null);
    setPendingId(plan.id);
    startTransition(async () => {
      const result = await togglePlanActiveAction(plan.id, !plan.is_active);
      setPendingId(null);
      if (!result.ok) setRowError(result.error ?? "Não foi possível atualizar.");
    });
  }

  function handleConfirmDelete() {
    if (!deleting) return;
    setDeleteError(null);
    setPendingId(deleting.id);
    startTransition(async () => {
      const result = await deletePlanAction(deleting.id);
      setPendingId(null);
      if (!result.ok) {
        setDeleteError(result.error ?? "Não foi possível excluir.");
        return;
      }
      setDeleting(null);
    });
  }

  return (
    <Card className="space-y-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-text-muted">Planos</h2>
          <p className="mt-1 text-sm text-text-muted">Os lojistas veem e assinam estes planos em /painel/plano.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="shrink-0">
          <span className="text-lg leading-none">+</span>
          Novo plano
        </Button>
      </div>

      {rowError && <ErrorState message={rowError} />}

      {plans.length === 0 ? (
        <EmptyState title="Nenhum plano cadastrado ainda." description="Crie o primeiro plano para liberar a assinatura dos lojistas." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="hidden grid-cols-12 gap-4 border-b border-border bg-surface-subdued/70 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-text-muted md:grid">
            <div className="col-span-4">Nome</div>
            <div className="col-span-3 text-center">Preço/mês</div>
            <div className="col-span-2 text-center">Status</div>
            <div className="col-span-3 text-right">Ações</div>
          </div>

          <div className="divide-y divide-border">
            {plans.map((plan) => {
              const isRowPending = isPending && pendingId === plan.id;
              return (
                <div
                  key={plan.id}
                  className="flex flex-col gap-2 p-3.5 md:grid md:grid-cols-12 md:items-center md:gap-4 md:px-4 md:py-3"
                >
                  <div className="md:col-span-4">
                    <span className="text-sm font-bold text-graphite">{plan.name}</span>
                    {plan.description && <p className="truncate text-xs text-text-muted">{plan.description}</p>}
                  </div>
                  <div className="flex items-center justify-between md:col-span-3 md:justify-center">
                    <span className="md:hidden text-xs font-medium text-text-muted">Preço:</span>
                    <span className="text-sm font-extrabold text-graphite">{formatCurrencyBRL(plan.price)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 md:col-span-2 md:justify-center">
                    <span className="md:hidden text-xs font-medium text-text-muted">Status:</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={plan.is_active}
                      disabled={isRowPending}
                      onClick={() => handleToggle(plan)}
                      className={`relative h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${
                        plan.is_active ? "bg-emerald" : "bg-surface-subdued"
                      }`}
                      title={plan.is_active ? "Ativo" : "Inativo"}
                    >
                      <span
                        className={`pointer-events-none block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                          plan.is_active ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                  <div className="flex items-center justify-end gap-1.5 border-t border-border pt-2 md:col-span-3 md:border-t-0 md:pt-0">
                    <button
                      type="button"
                      onClick={() => setEditing(plan)}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-graphite hover:bg-primary/10 hover:text-primary"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleting(plan);
                      }}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red hover:bg-red/10"
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Novo plano">
        <PlanFormFields action={createPlanAction} submitLabel="Criar plano" onSuccess={() => setCreateOpen(false)} />
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Editar plano">
        {editing && (
          <PlanFormFields action={updatePlanAction} plan={editing} submitLabel="Salvar alterações" onSuccess={() => setEditing(null)} />
        )}
      </Modal>

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title="Excluir plano?">
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            Tem certeza que deseja excluir o plano <span className="font-semibold text-graphite">{deleting?.name}</span>? Isso falha se algum
            restaurante estiver nesse plano no momento.
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
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-red px-5 text-sm font-semibold text-white transition-all duration-150 hover:bg-[#dc2626] disabled:cursor-not-allowed disabled:opacity-50"
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
