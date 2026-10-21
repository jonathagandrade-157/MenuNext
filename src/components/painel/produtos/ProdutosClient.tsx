"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { ChevronDown, ChevronUp, CircleCheck, CirclePause, ImageIcon, Package, Pencil, Plus, Search, Tags, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Modal } from "@/components/ui/Modal";
import { deleteProductAction, moveProductAction, toggleProductAvailableAction, updateProductAction } from "@/lib/actions/products";
import { formatCurrencyBRL } from "@/lib/products";
import type { AddonGroup, Category, Product, ProductAddonGroupWithGroup, ProductImage } from "@/lib/tenant";
import { ProductAddonGroupsManager } from "./ProductAddonGroupsManager";
import { ProductFormFields } from "./ProductFormFields";
import { ProductImagesManager } from "./ProductImagesManager";

type ImageWithUrl = ProductImage & { url: string };
type ProductUI = Product & { product_images: ImageWithUrl[] };

type StatusFilter = "all" | "available" | "unavailable";

export function ProdutosClient({
  initialProducts,
  categories,
  addonGroups,
  productAddonGroups,
  canEdit,
}: {
  initialProducts: ProductUI[];
  categories: Category[];
  addonGroups: AddonGroup[];
  productAddonGroups: ProductAddonGroupWithGroup[];
  /** OWNER cadastra, edita, exclui e reordena; STAFF só liga/desliga a disponibilidade (P1-02). O banco também recusa. */
  canEdit: boolean;
}) {
  // Sincroniza com initialProducts quando o Server Component busca dados
  // novos (após revalidatePath), ajustando durante o render (não em efeito).
  const [products, setProducts] = useState(initialProducts);
  const [syncedInitial, setSyncedInitial] = useState(initialProducts);
  if (initialProducts !== syncedInitial) {
    setSyncedInitial(initialProducts);
    setProducts(initialProducts);
  }

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const categoryOrder = useMemo(() => new Map(categories.map((c, i) => [c.id, i])), [categories]);

  const sorted = useMemo(
    () =>
      [...products].sort((a, b) => {
        const catDiff = (categoryOrder.get(a.category_id) ?? 0) - (categoryOrder.get(b.category_id) ?? 0);
        if (catDiff !== 0) return catDiff;
        return a.display_order - b.display_order;
      }),
    [products, categoryOrder]
  );

  const productsByCategory = useMemo(() => {
    const map = new Map<string, ProductUI[]>();
    for (const product of sorted) {
      const list = map.get(product.category_id) ?? [];
      list.push(product);
      map.set(product.category_id, list);
    }
    return map;
  }, [sorted]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sorted.filter((product) => {
      if (statusFilter === "available" && !product.is_available) return false;
      if (statusFilter === "unavailable" && product.is_available) return false;
      if (categoryFilter !== "all" && product.category_id !== categoryFilter) return false;
      if (query && !product.name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [sorted, search, statusFilter, categoryFilter]);

  const associationsByProduct = useMemo(() => {
    const map = new Map<string, ProductAddonGroupWithGroup[]>();
    for (const association of productAddonGroups) {
      const list = map.get(association.product_id) ?? [];
      list.push(association);
      map.set(association.product_id, list);
    }
    return map;
  }, [productAddonGroups]);

  const availableCount = products.filter((p) => p.is_available).length;
  const unavailableCount = products.length - availableCount;
  const activeCategoriesCount = categories.filter((c) => c.is_active).length;
  const editingProduct = editingId ? (products.find((p) => p.id === editingId) ?? null) : null;
  const deletingProduct = deletingId ? (products.find((p) => p.id === deletingId) ?? null) : null;

  function handleToggle(product: ProductUI) {
    setRowError(null);
    setPendingId(product.id);
    startTransition(async () => {
      const result = await toggleProductAvailableAction(product.id, !product.is_available);
      setPendingId(null);
      if (!result.ok) setRowError(result.error ?? "Não foi possível atualizar.");
    });
  }

  function handleMove(product: ProductUI, direction: "up" | "down") {
    setRowError(null);
    setPendingId(product.id);
    startTransition(async () => {
      const result = await moveProductAction(product.id, direction);
      setPendingId(null);
      if (!result.ok) setRowError(result.error ?? "Não foi possível reordenar.");
    });
  }

  function handleConfirmDelete() {
    if (!deletingProduct) return;
    setDeleteError(null);
    setPendingId(deletingProduct.id);
    startTransition(async () => {
      const result = await deleteProductAction(deletingProduct.id);
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
        <span className="text-graphite">Produtos</span>
      </nav>

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-headline-lg text-graphite">Produtos</h1>
          <p className="mt-0.5 text-body-md text-text-muted">
            {canEdit
              ? "Gerencie os itens disponíveis no cardápio da sua loja em tempo real."
              : "Ligue ou desligue a disponibilidade dos itens do cardápio em tempo real."}
          </p>
        </div>
        {canEdit && (
          <Link
            href="/painel/produtos/novo"
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 self-start rounded-xl bg-primary px-5 text-label-lg text-white shadow-[0_8px_20px_-4px_rgba(171,47,0,0.35)] transition-all hover:bg-primary-container sm:self-auto"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Novo produto
          </Link>
        )}
      </div>

      {products.length === 0 ? (
        <EmptyState
          title="Você ainda não possui produtos."
          description={canEdit ? "Cadastre o primeiro produto do seu cardápio." : "O responsável pela loja ainda não cadastrou produtos."}
          action={
            canEdit ? (
              <Link href="/painel/produtos/novo" className="mt-2 text-label-lg text-primary hover:underline">
                Novo produto →
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(
              [
                { label: "Total cadastrado", value: products.length, unit: "itens", icon: Package, tint: "bg-primary/10 text-primary" },
                { label: "Disponíveis hoje", value: availableCount, unit: "ativos", icon: CircleCheck, tint: "bg-emerald/10 text-emerald" },
                { label: "Pausados / Esgotados", value: unavailableCount, unit: "itens", icon: CirclePause, tint: "bg-blue/10 text-blue" },
                { label: "Categorias ativas", value: activeCategoriesCount, unit: "grupos", icon: Tags, tint: "bg-primary/10 text-primary" },
              ] as const
            ).map(({ label, value, unit, icon: Icon, tint }) => (
              <Card key={label} className="flex items-center gap-3 p-4">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tint}`}>
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-label-sm uppercase text-text-muted">{label}</p>
                  <p className="text-headline-lg text-graphite">
                    {value} <span className="text-body-sm font-normal text-text-muted">{unit}</span>
                  </p>
                </div>
              </Card>
            ))}
          </div>

          <Card className="flex flex-col gap-3 p-3.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative w-full max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar produto por nome..."
                  className="h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
                />
              </div>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="h-10 rounded-xl border border-border bg-surface px-3 text-body-md text-graphite focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
              >
                <option value="all">Todas as categorias</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1 overflow-x-auto rounded-xl bg-surface-subdued p-1">
              {(
                [
                  ["all", `Todos (${products.length})`],
                  ["available", `Disponíveis (${availableCount})`],
                  ["unavailable", `Indisponíveis (${unavailableCount})`],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-label-md transition-colors ${
                    statusFilter === value ? "bg-surface-card text-graphite shadow-card" : "text-text-muted hover:text-graphite"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Card>

          {rowError && <ErrorState message={rowError} />}

          <Card className="overflow-hidden p-0">
            <div className="hidden grid-cols-12 gap-4 border-b border-border bg-surface-subdued/70 px-5 py-3 text-label-sm uppercase text-text-muted md:grid">
              <div className="col-span-1 text-center">Ordem</div>
              <div className="col-span-4">Produto</div>
              <div className="col-span-2">Categoria</div>
              <div className="col-span-2 text-center">Preço</div>
              <div className="col-span-1 text-center">Disponível</div>
              <div className="col-span-2 text-right">Ações</div>
            </div>

            {visible.length === 0 ? (
              <p className="px-5 py-8 text-center text-body-md text-text-muted">
                Nenhum produto encontrado para essa busca/filtro.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {visible.map((product) => {
                  const isRowPending = isPending && pendingId === product.id;
                  const siblings = productsByCategory.get(product.category_id) ?? [];
                  const positionInCategory = siblings.findIndex((p) => p.id === product.id);
                  const isFirst = positionInCategory === 0;
                  const isLast = positionInCategory === siblings.length - 1;
                  const cover = product.product_images[0];
                  const category = categoryById.get(product.category_id);

                  return (
                    <div
                      key={product.id}
                      className="flex flex-col gap-3 p-4 transition-colors hover:bg-surface-subdued/60 md:grid md:grid-cols-12 md:items-center md:gap-4 md:px-5 md:py-3.5"
                    >
                      <div className="flex items-center justify-between md:col-span-1 md:justify-center">
                        <span className="text-label-md tabular-nums text-text-muted">
                          {String(positionInCategory + 1).padStart(2, "0")}
                        </span>
                      </div>

                      <div className="flex min-w-0 items-center gap-3 md:col-span-4">
                        {cover ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={cover.url} alt={product.name} className="h-14 w-14 shrink-0 rounded-xl object-cover shadow-sm" />
                        ) : (
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-surface-subdued text-text-muted">
                            <ImageIcon className="h-6 w-6" aria-hidden />
                          </div>
                        )}
                        <div className="min-w-0">
                          <h3 className="text-body-lg font-bold text-graphite">{product.name}</h3>
                          {(associationsByProduct.get(product.id)?.length ?? 0) > 0 && (
                            <span className="mt-1 inline-block rounded bg-surface-subdued px-1.5 py-0.5 text-label-sm text-text-muted">
                              Adicionais ({associationsByProduct.get(product.id)?.length})
                            </span>
                          )}
                          {product.description && (
                            <p className="mt-0.5 truncate text-body-sm text-text-muted">{product.description}</p>
                          )}
                        </div>
                      </div>

                      <div className="md:col-span-2">
                        <span className="inline-block rounded-md bg-surface-subdued px-2 py-1 text-label-md text-graphite">
                          {category?.name ?? "—"}
                        </span>
                      </div>

                      <div className="flex items-center justify-between md:col-span-2 md:justify-center">
                        <span className="md:hidden text-body-sm font-medium text-text-muted">Preço:</span>
                        <span className="text-body-lg font-bold text-graphite">{formatCurrencyBRL(product.price)}</span>
                      </div>

                      <div className="flex items-center justify-between gap-2 md:col-span-1 md:justify-center">
                        <span className="md:hidden text-body-sm font-medium text-text-muted">Disponível:</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={product.is_available}
                          disabled={isRowPending}
                          onClick={() => handleToggle(product)}
                          className={`relative h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${
                            product.is_available ? "bg-emerald" : "bg-surface-subdued"
                          }`}
                        >
                          <span
                            className={`pointer-events-none block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                              product.is_available ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                        <span className={`hidden text-label-sm xl:inline ${product.is_available ? "text-emerald" : "text-text-muted"}`}>
                          {product.is_available ? "Ativo" : "Pausado"}
                        </span>
                      </div>

                      {canEdit && (
                        <div className="flex items-center justify-end gap-1.5 border-t border-border pt-2 md:col-span-2 md:border-t-0 md:pt-0">
                          <button
                            type="button"
                            title="Mover para cima"
                            disabled={isFirst || isRowPending}
                            onClick={() => handleMove(product, "up")}
                            className="rounded-lg p-1.5 text-text-muted hover:bg-surface-subdued hover:text-graphite disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <ChevronUp className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            title="Mover para baixo"
                            disabled={isLast || isRowPending}
                            onClick={() => handleMove(product, "down")}
                            className="rounded-lg p-1.5 text-text-muted hover:bg-surface-subdued hover:text-graphite disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <ChevronDown className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            title="Editar produto"
                            aria-label={`Editar ${product.name}`}
                            onClick={() => setEditingId(product.id)}
                            className="rounded-lg p-1.5 text-text-muted hover:bg-primary/10 hover:text-primary"
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteError(null);
                              setDeletingId(product.id);
                            }}
                            title="Excluir produto"
                            aria-label={`Excluir ${product.name}`}
                            className="rounded-lg p-1.5 text-text-muted hover:bg-red/10 hover:text-red"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex flex-col gap-1 border-t border-border px-5 py-3 text-body-sm text-text-muted sm:flex-row sm:items-center sm:justify-between">
              <span>
                Exibindo {visible.length} de {products.length} produtos
              </span>
              {canEdit && <span>Dica: use as setas para mudar a ordem dos produtos dentro da categoria na loja digital.</span>}
            </div>
          </Card>
        </>
      )}

      <Modal open={editingProduct !== null} onClose={() => setEditingId(null)} title="Editar produto">
        {editingProduct && (
          <div className="space-y-5">
            <ProductImagesManager productId={editingProduct.id} images={editingProduct.product_images} />
            <div className="border-t border-border pt-4">
              <ProductFormFields
                action={updateProductAction}
                product={editingProduct}
                categories={categories}
                submitLabel="Salvar alterações"
                onSuccess={() => setEditingId(null)}
              />
            </div>
            <div className="border-t border-border pt-4">
              <ProductAddonGroupsManager
                productId={editingProduct.id}
                restaurantAddonGroups={addonGroups}
                associations={associationsByProduct.get(editingProduct.id) ?? []}
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal open={deletingProduct !== null} onClose={() => setDeletingId(null)} title="Excluir produto?">
        <div className="space-y-4">
          <p className="text-body-md text-text-muted">
            Tem certeza que deseja excluir <span className="font-semibold text-graphite">{deletingProduct?.name}</span>
            ? Essa ação não poderá ser desfeita.
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
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-red px-5 text-label-lg text-white transition-all duration-150 hover:bg-red/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending && pendingId === deletingProduct?.id && (
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
