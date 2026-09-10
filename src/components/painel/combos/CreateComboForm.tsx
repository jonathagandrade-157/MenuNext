"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import { createComboAction } from "@/lib/actions/combos";
import { formatCurrencyBRL } from "@/lib/combos";
import { initialComboState } from "@/lib/form-state";
import type { Product } from "@/lib/tenant";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" loading={pending} disabled={pending}>
      {pending ? "Salvando..." : "Salvar combo"}
    </Button>
  );
}

const inputClass =
  "h-11 w-full rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

type DraftItem = { productId: string; quantity: number };

/** Formulário de criação de combo: campos base + composição + imagem, tudo
 * enviado numa única submissão (createComboAction cria tudo atomicamente). */
export function CreateComboForm({ products, onSuccess }: { products: Product[]; onSuccess: () => void }) {
  const [state, formAction] = useActionState(createComboAction, initialComboState);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [pickedProductId, setPickedProductId] = useState("");
  const [pickedQuantity, setPickedQuantity] = useState("1");
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  useEffect(() => {
    if (state.status === "success") onSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const availableProducts = useMemo(
    () => products.filter((p) => !items.some((item) => item.productId === p.id)),
    [products, items]
  );

  function handleAddItem() {
    if (!pickedProductId) return;
    const quantity = Number(pickedQuantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return;
    setItems((prev) => [...prev, { productId: pickedProductId, quantity }]);
    setPickedProductId("");
    setPickedQuantity("1");
  }

  function handleRemoveItem(productId: string) {
    setItems((prev) => prev.filter((item) => item.productId !== productId));
  }

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setImagePreview(file ? URL.createObjectURL(file) : null);
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="itemsJson" value={JSON.stringify(items)} readOnly />

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-graphite">Imagem</span>
        <div className="flex items-center gap-3">
          {imagePreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imagePreview} alt="Pré-visualização do combo" className="h-16 w-16 rounded-lg object-cover" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-surface-subdued text-xs text-text-muted">
              Sem foto
            </div>
          )}
          <input
            type="file"
            name="image"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleImageChange}
            className="text-xs text-text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface-subdued file:px-3 file:py-2 file:text-xs file:font-semibold file:text-graphite"
          />
        </div>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-graphite">Nome *</span>
        <input name="name" type="text" required maxLength={80} placeholder="Ex.: Combo Casal" className={inputClass} />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-graphite">Descrição</span>
        <textarea
          name="description"
          maxLength={300}
          rows={2}
          placeholder="Ex.: Pizza grande + refrigerante 2L + sobremesa"
          className="w-full rounded-lg border border-border bg-surface-card px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-graphite">Preço do combo *</span>
        <input name="price" type="text" inputMode="decimal" required placeholder="89,90" className={inputClass} />
      </label>

      <label className="flex items-center gap-2">
        <input type="checkbox" name="isAvailable" defaultChecked className="h-4 w-4 rounded border-border" />
        <span className="text-sm font-semibold text-graphite">Disponível</span>
      </label>

      <div className="space-y-3 border-t border-border pt-4">
        <span className="block text-sm font-semibold text-graphite">Composição do combo *</span>

        {items.length === 0 ? (
          <p className="text-xs text-text-muted">Nenhum produto adicionado ainda.</p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((item) => {
              const product = productById.get(item.productId);
              return (
                <li
                  key={item.productId}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span className="text-graphite">
                    {product?.name ?? "Produto"} × {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(item.productId)}
                    className="text-xs font-semibold text-red hover:underline"
                  >
                    Remover
                  </button>
                </li>
              );
            })}
          </ul>
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
              disabled={!pickedProductId}
              onClick={handleAddItem}
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-border px-3 text-xs font-semibold text-graphite hover:bg-surface-subdued disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="text-sm leading-none">+</span>
              Adicionar produto
            </button>
          </div>
        )}
      </div>

      {state.status === "error" && <ErrorState message={state.message ?? "Não foi possível salvar."} />}

      <SubmitButton />
    </form>
  );
}
