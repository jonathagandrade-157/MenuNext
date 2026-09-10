"use client";

import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Modal } from "@/components/ui/Modal";
import {
  createCategoryAction,
  deleteCategoryAction,
  moveCategoryAction,
  toggleCategoryActiveAction,
  updateCategoryAction,
} from "@/lib/actions/categories";
import type { Category } from "@/lib/tenant";
import { CategoryFormFields } from "./CategoryFormFields";

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

export function CategoriasClient({ initialCategories }: { initialCategories: Category[] }) {
  // Sincroniza com initialCategories quando o Server Component busca dados
  // novos (após revalidatePath numa Server Action) — ajuste durante o
  // render, não em efeito, para não disparar um segundo render extra.
  const [categories, setCategories] = useState(initialCategories);
  const [syncedInitial, setSyncedInitial] = useState(initialCategories);
  if (initialCategories !== syncedInitial) {
    setSyncedInitial(initialCategories);
    setCategories(initialCategories);
  }

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const sorted = useMemo(() => [...categories].sort((a, b) => a.display_order - b.display_order), [categories]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sorted
      .map((category, index) => ({ category, position: index + 1 }))
      .filter(({ category }) => {
        if (filter === "active" && !category.is_active) return false;
        if (filter === "inactive" && category.is_active) return false;
        if (query && !category.name.toLowerCase().includes(query)) return false;
        return true;
      });
  }, [sorted, search, filter]);

  const activeCount = categories.filter((c) => c.is_active).length;
  const inactiveCount = categories.length - activeCount;

  function handleToggle(category: Category) {
    setRowError(null);
    setPendingId(category.id);
    startTransition(async () => {
      const result = await toggleCategoryActiveAction(category.id, !category.is_active);
      setPendingId(null);
      if (!result.ok) setRowError(result.error ?? "Não foi possível atualizar.");
    });
  }

  function handleMove(category: Category, direction: "up" | "down") {
    setRowError(null);
    setPendingId(category.id);
    startTransition(async () => {
      const result = await moveCategoryAction(category.id, direction);
      setPendingId(null);
      if (!result.ok) setRowError(result.error ?? "Não foi possível reordenar.");
    });
  }

  function handleConfirmDelete() {
    if (!deleting) return;
    setDeleteError(null);
    setPendingId(deleting.id);
    startTransition(async () => {
      const result = await deleteCategoryAction(deleting.id);
      setPendingId(null);
      if (!result.ok) {
        setDeleteError(result.error ?? "Não foi possível excluir.");
        return;
      }
      setDeleting(null);
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <nav className="flex items-center gap-2 text-xs font-medium text-text-muted">
        <span>Painel</span>
        <span>/</span>
        <span>Cardápio</span>
        <span>/</span>
        <span className="font-bold text-graphite">Categorias</span>
      </nav>

      <div className="flex flex-col justify-between gap-4 border-b border-border pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-graphite">Categorias</h1>
          <p className="mt-0.5 text-sm font-medium text-text-muted">
            Organize os produtos do seu cardápio e defina a ordem de exibição na loja
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="self-start sm:self-auto">
          <span className="text-lg leading-none">+</span>
          Nova categoria
        </Button>
      </div>

      {categories.length === 0 ? (
        <EmptyState
          title="Você ainda não possui categorias."
          description="Crie a primeira categoria para começar a organizar o cardápio da sua loja."
          action={
            <Button onClick={() => setCreateOpen(true)} className="mt-2">
              Criar categoria
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
                placeholder="Buscar categoria..."
                className="h-9 w-full max-w-md rounded-lg border border-border bg-surface px-3 text-xs text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
              />
              <div className="flex items-center gap-1.5 overflow-x-auto">
                {(
                  [
                    ["all", `Todas (${categories.length})`],
                    ["active", `Ativas (${activeCount})`],
                    ["inactive", `Inativas (${inactiveCount})`],
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
              <span className="font-bold text-graphite">{categories.length}</span> categorias cadastradas
            </p>
          </Card>

          {rowError && <ErrorState message={rowError} />}

          <Card className="overflow-hidden p-0">
            <div className="hidden grid-cols-12 gap-4 border-b border-border bg-surface-subdued/70 px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-text-muted md:grid">
              <div className="col-span-1 text-center">Ordem</div>
              <div className="col-span-5">Categoria</div>
              <div className="col-span-2 text-center">Produtos</div>
              <div className="col-span-2 text-center">Status na loja</div>
              <div className="col-span-2 text-right">Ações</div>
            </div>

            {visible.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-text-muted">
                Nenhuma categoria encontrada para essa busca/filtro.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {visible.map(({ category, position }) => {
                  const isRowPending = isPending && pendingId === category.id;
                  const isFirst = position === 1;
                  const isLast = position === sorted.length;
                  return (
                    <div
                      key={category.id}
                      className="flex flex-col gap-3 p-4 transition-colors hover:bg-surface-subdued/60 md:grid md:grid-cols-12 md:items-center md:gap-4 md:px-5 md:py-3.5"
                    >
                      <div className="flex items-center justify-between md:col-span-1 md:justify-center">
                        <span className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-surface-subdued text-xs font-bold text-graphite">
                          {position}º
                        </span>
                      </div>

                      <div className="min-w-0 md:col-span-5">
                        <h3 className="text-sm font-bold text-graphite">{category.name}</h3>
                        {category.description && (
                          <p className="mt-0.5 truncate text-xs text-text-muted">{category.description}</p>
                        )}
                      </div>

                      <div className="flex items-center justify-between md:col-span-2 md:justify-center">
                        <span className="md:hidden text-xs font-medium text-text-muted">Produtos:</span>
                        {/* Produtos ainda não existe nesta fase (sem products.category_id) — contagem real chega junto com o CRUD de Produtos. */}
                        <Badge tone="neutral">0 produtos</Badge>
                      </div>

                      <div className="flex items-center justify-between gap-3 md:col-span-2 md:justify-center">
                        <Badge tone={category.is_active ? "success" : "neutral"} pulse={category.is_active}>
                          {category.is_active ? "Ativa" : "Inativa"}
                        </Badge>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={category.is_active}
                          disabled={isRowPending}
                          onClick={() => handleToggle(category)}
                          className={`relative h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${
                            category.is_active ? "bg-emerald" : "bg-surface-subdued"
                          }`}
                        >
                          <span
                            className={`pointer-events-none block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                              category.is_active ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>

                      <div className="flex items-center justify-end gap-1.5 border-t border-border pt-2 md:col-span-2 md:border-t-0 md:pt-0">
                        <button
                          type="button"
                          title="Mover para cima"
                          disabled={isFirst || isRowPending}
                          onClick={() => handleMove(category, "up")}
                          className="rounded-lg p-1.5 text-text-muted hover:bg-surface-subdued hover:text-graphite disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <ChevronUpIcon />
                        </button>
                        <button
                          type="button"
                          title="Mover para baixo"
                          disabled={isLast || isRowPending}
                          onClick={() => handleMove(category, "down")}
                          className="rounded-lg p-1.5 text-text-muted hover:bg-surface-subdued hover:text-graphite disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <ChevronDownIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(category)}
                          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-graphite hover:bg-primary/10 hover:text-primary"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleting(category);
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
            )}
          </Card>
        </>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nova categoria">
        <CategoryFormFields action={createCategoryAction} submitLabel="Criar categoria" onSuccess={() => setCreateOpen(false)} />
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Editar categoria">
        {editing && (
          <CategoryFormFields
            action={updateCategoryAction}
            category={editing}
            submitLabel="Salvar alterações"
            onSuccess={() => setEditing(null)}
          />
        )}
      </Modal>

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title="Excluir categoria?">
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
    </div>
  );
}
