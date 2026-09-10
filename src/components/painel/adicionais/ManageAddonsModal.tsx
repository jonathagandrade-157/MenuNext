"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Modal } from "@/components/ui/Modal";
import {
  createAddonAction,
  deleteAddonAction,
  moveAddonAction,
  toggleAddonAvailableAction,
  updateAddonAction,
} from "@/lib/actions/addons";
import { formatCurrencyBRL } from "@/lib/products";
import type { Addon, AddonGroupWithAddons } from "@/lib/tenant";
import { AddonFormFields } from "./AddonFormFields";

function ChevronUpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
      <path d="m6 15 6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Modal "Gerenciar itens" de um grupo — aberta a partir da lista de grupos. */
export function ManageAddonsModal({ group, onClose }: { group: AddonGroupWithAddons | null; onClose: () => void }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Addon | null>(null);
  const [deleting, setDeleting] = useState<Addon | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const sorted = group ? [...group.addons].sort((a, b) => a.display_order - b.display_order) : [];

  function handleToggle(addon: Addon) {
    setRowError(null);
    setPendingId(addon.id);
    startTransition(async () => {
      const result = await toggleAddonAvailableAction(addon.id, !addon.is_available);
      setPendingId(null);
      if (!result.ok) setRowError(result.error ?? "Não foi possível atualizar.");
    });
  }

  function handleMove(addon: Addon, direction: "up" | "down") {
    setRowError(null);
    setPendingId(addon.id);
    startTransition(async () => {
      const result = await moveAddonAction(addon.id, direction);
      setPendingId(null);
      if (!result.ok) setRowError(result.error ?? "Não foi possível reordenar.");
    });
  }

  function handleConfirmDelete() {
    if (!deleting) return;
    setDeleteError(null);
    setPendingId(deleting.id);
    startTransition(async () => {
      const result = await deleteAddonAction(deleting.id);
      setPendingId(null);
      if (!result.ok) {
        setDeleteError(result.error ?? "Não foi possível excluir.");
        return;
      }
      setDeleting(null);
    });
  }

  return (
    <>
      <Modal open={group !== null} onClose={onClose} title={group ? `Itens de "${group.name}"` : "Itens do grupo"}>
        {group && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-text-muted">
                {sorted.length} adicional{sorted.length === 1 ? "" : "is"} neste grupo
              </p>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <span className="text-base leading-none">+</span>
                Adicionar adicional
              </Button>
            </div>

            {rowError && <ErrorState message={rowError} />}

            {sorted.length === 0 ? (
              <EmptyState
                title="Nenhum adicional neste grupo ainda."
                description="Adicione o primeiro item para começar a compor este grupo."
              />
            ) : (
              <div className="max-h-96 space-y-2 overflow-y-auto">
                {sorted.map((addon, index) => {
                  const isRowPending = isPending && pendingId === addon.id;
                  return (
                    <div
                      key={addon.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-graphite">{addon.name}</p>
                        <p className="text-xs text-text-muted">
                          {addon.price > 0 ? `+ ${formatCurrencyBRL(addon.price)}` : "Sem custo adicional"}
                        </p>
                      </div>
                      <Badge tone={addon.is_available ? "success" : "neutral"}>
                        {addon.is_available ? "Disponível" : "Indisponível"}
                      </Badge>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          title="Mover para cima"
                          disabled={index === 0 || isRowPending}
                          onClick={() => handleMove(addon, "up")}
                          className="rounded-lg p-1 text-text-muted hover:bg-surface-subdued hover:text-graphite disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <ChevronUpIcon />
                        </button>
                        <button
                          type="button"
                          title="Mover para baixo"
                          disabled={index === sorted.length - 1 || isRowPending}
                          onClick={() => handleMove(addon, "down")}
                          className="rounded-lg p-1 text-text-muted hover:bg-surface-subdued hover:text-graphite disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <ChevronDownIcon />
                        </button>
                        <button
                          type="button"
                          disabled={isRowPending}
                          onClick={() => handleToggle(addon)}
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-graphite hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                        >
                          {addon.is_available ? "Desativar" : "Ativar"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(addon)}
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-graphite hover:bg-primary/10 hover:text-primary"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleting(addon);
                          }}
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-red hover:bg-red/10"
                        >
                          Excluir
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Novo adicional">
        {group && (
          <AddonFormFields
            action={createAddonAction}
            addonGroupId={group.id}
            submitLabel="Salvar adicional"
            onSuccess={() => setCreateOpen(false)}
          />
        )}
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Editar adicional">
        {group && editing && (
          <AddonFormFields
            action={updateAddonAction}
            addonGroupId={group.id}
            addon={editing}
            submitLabel="Salvar alterações"
            onSuccess={() => setEditing(null)}
          />
        )}
      </Modal>

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title="Excluir adicional?">
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            Tem certeza que deseja excluir <span className="font-semibold text-graphite">{deleting?.name}</span>? Essa
            ação não poderá ser desfeita.
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
    </>
  );
}
