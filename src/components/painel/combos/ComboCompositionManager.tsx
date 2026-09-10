"use client";

import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { ErrorState } from "@/components/ui/States";
import {
  addComboItemAction,
  moveComboItemAction,
  removeComboItemAction,
  updateComboItemAction,
} from "@/lib/actions/combos";
import { formatCurrencyBRL } from "@/lib/combos";
import type { ComboItemWithProduct, Product } from "@/lib/tenant";

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

/** Composição do combo no editor: alterar quantidade, remover produto,
 * adicionar produto, reordenar — restrito aos produtos do próprio restaurante. */
export function ComboCompositionManager({
  comboId,
  items,
  restaurantProducts,
}: {
  comboId: string;
  items: ComboItemWithProduct[];
  restaurantProducts: Product[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pickedProductId, setPickedProductId] = useState("");
  const [pickedQuantity, setPickedQuantity] = useState("1");

  const sorted = useMemo(() => [...items].sort((a, b) => a.display_order - b.display_order), [items]);

  const availableProducts = useMemo(
    () => restaurantProducts.filter((p) => !items.some((item) => item.product_id === p.id)),
    [restaurantProducts, items]
  );

  function handleQuantityChange(itemId: string, quantity: number) {
    setError(null);
    setPendingId(itemId);
    startTransition(async () => {
      const result = await updateComboItemAction(itemId, quantity);
      setPendingId(null);
      if (!result.ok) setError(result.error ?? "Não foi possível atualizar a quantidade.");
    });
  }

  function handleRemove(itemId: string) {
    setError(null);
    setPendingId(itemId);
    startTransition(async () => {
      const result = await removeComboItemAction(itemId);
      setPendingId(null);
      if (!result.ok) setError(result.error ?? "Não foi possível remover.");
    });
  }

  function handleMove(itemId: string, direction: "up" | "down") {
    setError(null);
    setPendingId(itemId);
    startTransition(async () => {
      const result = await moveComboItemAction(itemId, direction);
      setPendingId(null);
      if (!result.ok) setError(result.error ?? "Não foi possível reordenar.");
    });
  }

  function handleAdd() {
    if (!pickedProductId) return;
    const quantity = Number(pickedQuantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return;
    setError(null);
    setPendingId("new");
    startTransition(async () => {
      const result = await addComboItemAction(comboId, pickedProductId, quantity);
      setPendingId(null);
      if (!result.ok) {
        setError(result.error ?? "Não foi possível adicionar o produto.");
        return;
      }
      setPickedProductId("");
      setPickedQuantity("1");
    });
  }

  return (
    <div className="space-y-3">
      <span className="block text-sm font-semibold text-graphite">Composição do combo</span>

      {sorted.length === 0 ? (
        <p className="text-xs text-text-muted">Nenhum produto neste combo.</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((item, index) => {
            const isRowPending = isPending && pendingId === item.id;
            return (
              <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-graphite">{item.product.name}</p>
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs text-text-muted">{formatCurrencyBRL(item.product.price)}</p>
                    {!item.product.is_available && <Badge tone="warning">⚠️ Produto indisponível</Badge>}
                  </div>
                </div>
                <input
                  type="number"
                  min={1}
                  max={99}
                  defaultValue={item.quantity}
                  disabled={isRowPending}
                  onBlur={(e) => {
                    const value = Number(e.target.value);
                    if (Number.isInteger(value) && value >= 1 && value <= 99 && value !== item.quantity) {
                      handleQuantityChange(item.id, value);
                    }
                  }}
                  className="h-8 w-14 rounded-lg border border-border bg-surface px-2 text-center text-xs font-semibold text-graphite focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
                />
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    title="Mover para cima"
                    disabled={index === 0 || isRowPending}
                    onClick={() => handleMove(item.id, "up")}
                    className="rounded-lg p-1 text-text-muted hover:bg-surface-subdued hover:text-graphite disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ChevronUpIcon />
                  </button>
                  <button
                    type="button"
                    title="Mover para baixo"
                    disabled={index === sorted.length - 1 || isRowPending}
                    onClick={() => handleMove(item.id, "down")}
                    className="rounded-lg p-1 text-text-muted hover:bg-surface-subdued hover:text-graphite disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ChevronDownIcon />
                  </button>
                  <button
                    type="button"
                    disabled={isRowPending}
                    onClick={() => handleRemove(item.id)}
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-red hover:bg-red/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Remover
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {availableProducts.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={pickedProductId}
            onChange={(e) => setPickedProductId(e.target.value)}
            className="h-9 flex-1 rounded-lg border border-border bg-surface px-2.5 text-xs font-semibold text-graphite focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
          >
            <option value="">Selecione um produto...</option>
            {availableProducts.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} ({formatCurrencyBRL(product.price)})
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            max={99}
            value={pickedQuantity}
            onChange={(e) => setPickedQuantity(e.target.value)}
            className="h-9 w-16 rounded-lg border border-border bg-surface px-2 text-center text-xs font-semibold text-graphite focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
          />
          <button
            type="button"
            disabled={!pickedProductId || isPending}
            onClick={handleAdd}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-border px-3 text-xs font-semibold text-graphite hover:bg-surface-subdued disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="text-sm leading-none">+</span>
            Adicionar produto
          </button>
        </div>
      )}

      {error && <ErrorState message={error} />}
    </div>
  );
}
