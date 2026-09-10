"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Modal } from "@/components/ui/Modal";
import { deleteProductAction, moveProductAction, toggleProductAvailableAction, updateProductAction } from "@/lib/actions/products";
import { formatCurrencyBRL } from "@/lib/products";
import type { Category, Product, ProductImage } from "@/lib/tenant";
import { ProductFormFields } from "./ProductFormFields";
import { ProductImagesManager } from "./ProductImagesManager";

type ImageWithUrl = ProductImage & { url: string };
type ProductUI = Product & { product_images: ImageWithUrl[] };

type StatusFilter = "all" | "available" | "unavailable";

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

function ImagePlaceholderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="9" r="1.5" />
      <path d="m21 15-5-5-9 9" />
    </svg>
  );
}

export function ProdutosClient({
  initialProducts,
  categories,
}: {
  initialProducts: ProductUI[];
  categories: Category[];
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

  const availableCount = products.filter((p) => p.is_available).length;
  const unavailableCount = products.length - availableCount;
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
      <nav className="flex items-center gap-2 text-xs font-medium text-text-muted">
        <span>Painel</span>
        <span>/</span>
        <span>Cardápio</span>
        <span>/</span>
        <span className="font-bold text-graphite">Produtos</span>
      </nav>

      <div className="flex flex-col justify-between gap-4 border-b border-border pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-graphite">Produtos</h1>
          <p className="mt-0.5 text-sm font-medium text-text-muted">
            Gerencie os itens disponíveis no cardápio da sua loja em tempo real.
          </p>
        </div>
        <Link
          href="/painel/produtos/novo"
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 self-start rounded-xl bg-primary px-5 text-sm font-semibold text-white shadow-[0_8px_20px_-4px_rgba(249,87,33,0.35)] transition-all hover:bg-[#ff5436] sm:self-auto"
        >
          <span className="text-lg leading-none">+</span>
          Novo produto
        </Link>
      </div>

      {products.length === 0 ? (
        <EmptyState
          title="Você ainda não possui produtos."
          description="Cadastre o primeiro produto do seu cardápio."
          action={
            <Link href="/painel/produtos/novo" className="mt-2 text-sm font-semibold text-primary hover:underline">
              Novo produto →
            </Link>
          }
        />
      ) : (
        <>
          <Card className="flex flex-col gap-3 p-3.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar produto por nome..."
                className="h-9 w-full max-w-md rounded-lg border border-border bg-surface px-3 text-xs text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
              />
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="h-9 rounded-lg border border-border bg-surface px-2.5 text-xs font-semibold text-graphite focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
              >
                <option value="all">Todas as categorias</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto">
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
                  className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-bold transition-colors ${
                    statusFilter === value ? "bg-primary text-white" : "text-text-muted hover:bg-surface-subdued"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Card>

          {rowError && <ErrorState message={rowError} />}

          <Card className="overflow-hidden p-0">
            <div className="hidden grid-cols-12 gap-4 border-b border-border bg-surface-subdued/70 px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-text-muted md:grid">
              <div className="col-span-1 text-center">Ordem</div>
              <div className="col-span-4">Produto</div>
              <div className="col-span-2">Categoria</div>
              <div className="col-span-2 text-center">Preço</div>
              <div className="col-span-1 text-center">Disponível</div>
              <div className="col-span-2 text-right">Ações</div>
            </div>

            {visible.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-text-muted">
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
                        <span className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-surface-subdued text-xs font-bold text-graphite">
                          {positionInCategory + 1}º
                        </span>
                      </div>

                      <div className="flex min-w-0 items-center gap-3 md:col-span-4">
                        {cover ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={cover.url} alt={product.name} className="h-14 w-14 shrink-0 rounded-xl object-cover shadow-sm" />
                        ) : (
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-surface-subdued text-text-muted">
                            <ImagePlaceholderIcon />
                          </div>
                        )}
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold text-graphite">{product.name}</h3>
                          {product.description && (
                            <p className="mt-0.5 truncate text-xs text-text-muted">{product.description}</p>
                          )}
                        </div>
                      </div>

                      <div className="md:col-span-2">
                        <Badge tone="neutral">{category?.name ?? "—"}</Badge>
                      </div>

                      <div className="flex items-center justify-between md:col-span-2 md:justify-center">
                        <span className="md:hidden text-xs font-medium text-text-muted">Preço:</span>
                        <span className="text-sm font-extrabold text-graphite">{formatCurrencyBRL(product.price)}</span>
                      </div>

                      <div className="flex items-center justify-between gap-3 md:col-span-1 md:justify-center">
                        <span className="md:hidden text-xs font-medium text-text-muted">Disponível:</span>
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
                      </div>

                      <div className="flex items-center justify-end gap-1.5 border-t border-border pt-2 md:col-span-2 md:border-t-0 md:pt-0">
                        <button
                          type="button"
                          title="Mover para cima"
                          disabled={isFirst || isRowPending}
                          onClick={() => handleMove(product, "up")}
                          className="rounded-lg p-1.5 text-text-muted hover:bg-surface-subdued hover:text-graphite disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <ChevronUpIcon />
                        </button>
                        <button
                          type="button"
                          title="Mover para baixo"
                          disabled={isLast || isRowPending}
                          onClick={() => handleMove(product, "down")}
                          className="rounded-lg p-1.5 text-text-muted hover:bg-surface-subdued hover:text-graphite disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <ChevronDownIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(product.id)}
                          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-graphite hover:bg-primary/10 hover:text-primary"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setDeletingId(product.id);
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
          </div>
        )}
      </Modal>

      <Modal open={deletingProduct !== null} onClose={() => setDeletingId(null)} title="Excluir produto?">
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
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
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-red px-5 text-sm font-semibold text-white transition-all duration-150 hover:bg-[#dc2626] disabled:cursor-not-allowed disabled:opacity-50"
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
