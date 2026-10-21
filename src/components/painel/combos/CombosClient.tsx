"use client";

import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Modal } from "@/components/ui/Modal";
import { deleteComboAction, moveComboAction, toggleComboAvailableAction } from "@/lib/actions/combos";
import { formatCurrencyBRL } from "@/lib/combos";
import type { ComboWithItems, Product } from "@/lib/tenant";
import { ComboCompositionManager } from "./ComboCompositionManager";
import { ComboFormFields } from "./ComboFormFields";
import { ComboImageManager } from "./ComboImageManager";
import { CreateComboForm } from "./CreateComboForm";
import { ChevronDown, ChevronUp, Pencil, Search, Trash2 } from "lucide-react";

type ComboUI = ComboWithItems & { imageUrl: string | null };
type Filter = "all" | "available" | "unavailable";

function ImagePlaceholderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="9" r="1.5" />
      <path d="m21 15-5-5-9 9" />
    </svg>
  );
}

export function CombosClient({ initialCombos, products }: { initialCombos: ComboUI[]; products: Product[] }) {
  // Sincroniza com initialCombos quando o Server Component busca dados novos
  // (após revalidatePath numa Server Action) — ajuste durante o render.
  const [combos, setCombos] = useState(initialCombos);
  const [syncedInitial, setSyncedInitial] = useState(initialCombos);
  if (initialCombos !== syncedInitial) {
    setSyncedInitial(initialCombos);
    setCombos(initialCombos);
  }

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const sorted = useMemo(() => [...combos].sort((a, b) => a.display_order - b.display_order), [combos]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sorted
      .map((combo, index) => ({ combo, position: index + 1 }))
      .filter(({ combo }) => {
        if (filter === "available" && !combo.is_available) return false;
        if (filter === "unavailable" && combo.is_available) return false;
        if (query && !combo.name.toLowerCase().includes(query)) return false;
        return true;
      });
  }, [sorted, search, filter]);

  const availableCount = combos.filter((c) => c.is_available).length;
  const unavailableCount = combos.length - availableCount;
  const editingCombo = editingId ? (combos.find((c) => c.id === editingId) ?? null) : null;
  const deletingCombo = deletingId ? (combos.find((c) => c.id === deletingId) ?? null) : null;

  function handleToggle(combo: ComboUI) {
    setRowError(null);
    setPendingId(combo.id);
    startTransition(async () => {
      const result = await toggleComboAvailableAction(combo.id, !combo.is_available);
      setPendingId(null);
      if (!result.ok) setRowError(result.error ?? "Não foi possível atualizar.");
    });
  }

  function handleMove(combo: ComboUI, direction: "up" | "down") {
    setRowError(null);
    setPendingId(combo.id);
    startTransition(async () => {
      const result = await moveComboAction(combo.id, direction);
      setPendingId(null);
      if (!result.ok) setRowError(result.error ?? "Não foi possível reordenar.");
    });
  }

  function handleConfirmDelete() {
    if (!deletingCombo) return;
    setDeleteError(null);
    setPendingId(deletingCombo.id);
    startTransition(async () => {
      const result = await deleteComboAction(deletingCombo.id);
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
      <nav className="flex items-center gap-2 text-label-md text-text-muted">
        <span>Painel</span>
        <span>/</span>
        <span>Cardápio</span>
        <span>/</span>
        <span className="text-graphite">Combos</span>
      </nav>

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-headline-lg text-graphite">Combos</h1>
          <p className="mt-0.5 text-body-md text-text-muted">
            Combinações de produtos existentes com preço próprio, definido por você.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="self-start sm:self-auto">
          <span className="text-lg leading-none">+</span>
          Novo combo
        </Button>
      </div>

      {combos.length === 0 ? (
        <EmptyState
          title="Você ainda não possui combos."
          description="Crie o primeiro combo combinando produtos já cadastrados no seu cardápio."
          action={
            <Button onClick={() => setCreateOpen(true)} className="mt-2">
              Criar combo
            </Button>
          }
        />
      ) : (
        <>
          <Card className="flex flex-col justify-between gap-3 p-3.5 sm:flex-row sm:items-center">
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative w-full max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar combo por nome..."
                    className="h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
                  />
              </div>
              <div className="flex items-center gap-1 overflow-x-auto rounded-xl bg-surface-subdued p-1">
                {(
                  [
                    ["all", `Todos (${combos.length})`],
                    ["available", `Disponíveis (${availableCount})`],
                    ["unavailable", `Indisponíveis (${unavailableCount})`],
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
            </div>
            <p className="shrink-0 text-xs font-medium text-text-muted">
              <span className="font-bold text-graphite">{combos.length}</span> combos cadastrados
            </p>
          </Card>

          {rowError && <ErrorState message={rowError} />}

          {visible.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-text-muted">
              Nenhum combo encontrado para essa busca/filtro.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {visible.map(({ combo, position }) => {
                const isRowPending = isPending && pendingId === combo.id;
                const isFirst = position === 1;
                const isLast = position === sorted.length;
                const hasUnavailableProduct = combo.combo_items.some((item) => !item.product.is_available);
                return (
                  <Card key={combo.id} className="flex flex-col gap-3 p-4">
                    <div className="flex items-start gap-3">
                      {combo.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={combo.imageUrl} alt={combo.name} className="h-14 w-14 shrink-0 rounded-xl object-cover shadow-sm" />
                      ) : (
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-surface-subdued text-text-muted">
                          <ImagePlaceholderIcon />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface-subdued text-xs font-bold text-graphite">
                            {position}º
                          </span>
                          <h3 className="truncate text-sm font-bold text-graphite">{combo.name}</h3>
                        </div>
                        {combo.description && <p className="mt-1 truncate text-xs text-text-muted">{combo.description}</p>}
                      </div>
                      <Badge tone={combo.is_available ? "success" : "neutral"} pulse={combo.is_available}>
                        {combo.is_available ? "Disponível" : "Indisponível"}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">
                        {combo.combo_items.length} produto{combo.combo_items.length === 1 ? "" : "s"}
                      </Badge>
                      <span className="text-sm font-extrabold text-graphite">{formatCurrencyBRL(combo.price)}</span>
                      {hasUnavailableProduct && (
                        <Badge tone="warning">⚠️ Produto indisponível na composição</Badge>
                      )}
                    </div>

                    <div className="mt-auto flex flex-wrap items-center justify-end gap-1.5 border-t border-border pt-3">
                      <button
                        type="button"
                        title="Mover para cima"
                        disabled={isFirst || isRowPending}
                        onClick={() => handleMove(combo, "up")}
                        className="rounded-lg p-1.5 text-text-muted hover:bg-surface-subdued hover:text-graphite disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <ChevronUp className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        title="Mover para baixo"
                        disabled={isLast || isRowPending}
                        onClick={() => handleMove(combo, "down")}
                        className="rounded-lg p-1.5 text-text-muted hover:bg-surface-subdued hover:text-graphite disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <ChevronDown className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        disabled={isRowPending}
                        onClick={() => handleToggle(combo)}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-graphite hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                      >
                        {combo.is_available ? "Desativar" : "Ativar"}
                      </button>
                      <button
                        type="button"
                        title="Editar"
                        aria-label="Editar"
                        onClick={() => setEditingId(combo.id)}
                        className="rounded-lg p-1.5 text-text-muted hover:bg-primary/10 hover:text-primary"
                      >
                          <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteError(null);
                          setDeletingId(combo.id);
                        }}
                        title="Excluir"
                        aria-label="Excluir"
                        className="rounded-lg p-1.5 text-text-muted hover:bg-red/10 hover:text-red"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Novo combo">
        <CreateComboForm products={products} onSuccess={() => setCreateOpen(false)} />
      </Modal>

      <Modal open={editingCombo !== null} onClose={() => setEditingId(null)} title="Editar combo">
        {editingCombo && (
          <div className="space-y-5">
            <ComboImageManager comboId={editingCombo.id} imageUrl={editingCombo.imageUrl} />
            <div className="border-t border-border pt-4">
              <ComboFormFields combo={editingCombo} onSuccess={() => setEditingId(null)} />
            </div>
            <div className="border-t border-border pt-4">
              <ComboCompositionManager
                comboId={editingCombo.id}
                items={editingCombo.combo_items}
                restaurantProducts={products}
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal open={deletingCombo !== null} onClose={() => setDeletingId(null)} title="Excluir combo?">
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            Tem certeza que deseja excluir <span className="font-semibold text-graphite">{deletingCombo?.name}</span>?
            Os produtos do cardápio não serão afetados. Essa ação não poderá ser desfeita.
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
              {isPending && pendingId === deletingCombo?.id && (
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
