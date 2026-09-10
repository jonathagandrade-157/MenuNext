"use client";

import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Modal } from "@/components/ui/Modal";
import { describeAddonGroupRules } from "@/lib/addons";
import {
  createAddonGroupAction,
  deleteAddonGroupAction,
  moveAddonGroupAction,
  toggleAddonGroupActiveAction,
  updateAddonGroupAction,
} from "@/lib/actions/addons";
import type { AddonGroupWithAddons } from "@/lib/tenant";
import { AddonGroupFormFields } from "./AddonGroupFormFields";
import { ManageAddonsModal } from "./ManageAddonsModal";

type Filter = "all" | "active" | "inactive";

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

export function AdicionaisClient({ initialGroups }: { initialGroups: AddonGroupWithAddons[] }) {
  // Sincroniza com initialGroups quando o Server Component busca dados novos
  // (após revalidatePath numa Server Action) — ajuste durante o render.
  const [groups, setGroups] = useState(initialGroups);
  const [syncedInitial, setSyncedInitial] = useState(initialGroups);
  if (initialGroups !== syncedInitial) {
    setSyncedInitial(initialGroups);
    setGroups(initialGroups);
  }

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [managingId, setManagingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const sorted = useMemo(() => [...groups].sort((a, b) => a.display_order - b.display_order), [groups]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sorted
      .map((group, index) => ({ group, position: index + 1 }))
      .filter(({ group }) => {
        if (filter === "active" && !group.is_active) return false;
        if (filter === "inactive" && group.is_active) return false;
        if (query && !group.name.toLowerCase().includes(query)) return false;
        return true;
      });
  }, [sorted, search, filter]);

  const activeCount = groups.filter((g) => g.is_active).length;
  const inactiveCount = groups.length - activeCount;

  const editingGroup = editingId ? (groups.find((g) => g.id === editingId) ?? null) : null;
  const managingGroup = managingId ? (groups.find((g) => g.id === managingId) ?? null) : null;
  const deletingGroup = deletingId ? (groups.find((g) => g.id === deletingId) ?? null) : null;

  function handleToggle(group: AddonGroupWithAddons) {
    setRowError(null);
    setPendingId(group.id);
    startTransition(async () => {
      const result = await toggleAddonGroupActiveAction(group.id, !group.is_active);
      setPendingId(null);
      if (!result.ok) setRowError(result.error ?? "Não foi possível atualizar.");
    });
  }

  function handleMove(group: AddonGroupWithAddons, direction: "up" | "down") {
    setRowError(null);
    setPendingId(group.id);
    startTransition(async () => {
      const result = await moveAddonGroupAction(group.id, direction);
      setPendingId(null);
      if (!result.ok) setRowError(result.error ?? "Não foi possível reordenar.");
    });
  }

  function handleConfirmDelete() {
    if (!deletingGroup) return;
    setDeleteError(null);
    setPendingId(deletingGroup.id);
    startTransition(async () => {
      const result = await deleteAddonGroupAction(deletingGroup.id);
      setPendingId(null);
      if (!result.ok) {
        setDeleteError(result.error ?? "Não foi possível excluir.");
        return;
      }
      setDeletingId(null);
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <nav className="flex items-center gap-2 text-xs font-medium text-text-muted">
        <span>Painel</span>
        <span>/</span>
        <span>Cardápio</span>
        <span>/</span>
        <span className="font-bold text-graphite">Adicionais</span>
      </nav>

      <div className="flex flex-col justify-between gap-4 border-b border-border pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-graphite">Adicionais e complementos</h1>
          <p className="mt-0.5 text-sm font-medium text-text-muted">
            Grupos de adicionais obrigatórios ou opcionais aplicáveis aos produtos do seu cardápio.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="self-start sm:self-auto">
          <span className="text-lg leading-none">+</span>
          Novo grupo
        </Button>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title="Você ainda não possui grupos de adicionais."
          description="Crie o primeiro grupo (ex.: Borda recheada, Tamanho, Ponto da carne) para começar a compor os produtos do seu cardápio."
          action={
            <Button onClick={() => setCreateOpen(true)} className="mt-2">
              Criar grupo
            </Button>
          }
        />
      ) : (
        <>
          <Card className="flex flex-col justify-between gap-3 p-3.5 sm:flex-row sm:items-center">
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar grupo de adicionais..."
                className="h-9 w-full max-w-md rounded-lg border border-border bg-surface px-3 text-xs text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
              />
              <div className="flex items-center gap-1.5 overflow-x-auto">
                {(
                  [
                    ["all", `Todos (${groups.length})`],
                    ["active", `Ativos (${activeCount})`],
                    ["inactive", `Inativos (${inactiveCount})`],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-bold transition-colors ${
                      filter === value ? "bg-primary text-white" : "text-text-muted hover:bg-surface-subdued"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="shrink-0 text-xs font-medium text-text-muted">
              <span className="font-bold text-graphite">{groups.length}</span> grupos cadastrados
            </p>
          </Card>

          {rowError && <ErrorState message={rowError} />}

          {visible.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-text-muted">
              Nenhum grupo encontrado para essa busca/filtro.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {visible.map(({ group, position }) => {
                const isRowPending = isPending && pendingId === group.id;
                const isFirst = position === 1;
                const isLast = position === sorted.length;
                return (
                  <Card key={group.id} className="flex flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface-subdued text-xs font-bold text-graphite">
                            {position}º
                          </span>
                          <h3 className="truncate text-sm font-bold text-graphite">{group.name}</h3>
                        </div>
                        {group.description && (
                          <p className="mt-1 truncate text-xs text-text-muted">{group.description}</p>
                        )}
                      </div>
                      <Badge tone={group.is_active ? "success" : "neutral"} pulse={group.is_active}>
                        {group.is_active ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">
                        {group.addons.length} item{group.addons.length === 1 ? "" : "s"}
                      </Badge>
                      <Badge tone="info">{describeAddonGroupRules(group)}</Badge>
                    </div>

                    <div className="mt-auto flex flex-wrap items-center justify-end gap-1.5 border-t border-border pt-3">
                      <button
                        type="button"
                        title="Mover para cima"
                        disabled={isFirst || isRowPending}
                        onClick={() => handleMove(group, "up")}
                        className="rounded-lg p-1.5 text-text-muted hover:bg-surface-subdued hover:text-graphite disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <ChevronUpIcon />
                      </button>
                      <button
                        type="button"
                        title="Mover para baixo"
                        disabled={isLast || isRowPending}
                        onClick={() => handleMove(group, "down")}
                        className="rounded-lg p-1.5 text-text-muted hover:bg-surface-subdued hover:text-graphite disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <ChevronDownIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => setManagingId(group.id)}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-graphite hover:bg-primary/10 hover:text-primary"
                      >
                        Gerenciar itens
                      </button>
                      <button
                        type="button"
                        disabled={isRowPending}
                        onClick={() => handleToggle(group)}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-graphite hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                      >
                        {group.is_active ? "Desativar" : "Ativar"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(group.id)}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-graphite hover:bg-primary/10 hover:text-primary"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteError(null);
                          setDeletingId(group.id);
                        }}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red hover:bg-red/10"
                      >
                        Excluir
                      </button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Novo grupo de adicionais">
        <AddonGroupFormFields action={createAddonGroupAction} submitLabel="Salvar grupo" onSuccess={() => setCreateOpen(false)} />
      </Modal>

      <Modal open={editingGroup !== null} onClose={() => setEditingId(null)} title="Editar grupo de adicionais">
        {editingGroup && (
          <AddonGroupFormFields
            action={updateAddonGroupAction}
            group={editingGroup}
            submitLabel="Salvar alterações"
            onSuccess={() => setEditingId(null)}
          />
        )}
      </Modal>

      <ManageAddonsModal group={managingGroup} onClose={() => setManagingId(null)} />

      <Modal open={deletingGroup !== null} onClose={() => setDeletingId(null)} title="Excluir grupo?">
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            Tem certeza que deseja excluir{" "}
            <span className="font-semibold text-graphite">{deletingGroup?.name}</span>? Essa ação não poderá ser
            desfeita.
          </p>
          {deleteError && <ErrorState message={deleteError} />}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeletingId(null)} disabled={isPending}>
              Cancelar
            </Button>
            <button
              type="button"
              onClick={handleConfirmDelete}
              disabled={isPending}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-red px-5 text-sm font-semibold text-white transition-all duration-150 hover:bg-[#dc2626] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending && pendingId === deletingGroup?.id && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              )}
              Excluir
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
