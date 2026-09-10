"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import { initialProductState, type ProductActionState } from "@/lib/form-state";
import type { Category, Product } from "@/lib/tenant";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" loading={pending} disabled={pending}>
      {pending ? "Salvando..." : label}
    </Button>
  );
}

const inputClass =
  "h-11 w-full rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

/** Campos de edição de um produto já existente (imagens são geridas à parte). */
export function ProductFormFields({
  action,
  product,
  categories,
  submitLabel,
  onSuccess,
}: {
  action: (prev: ProductActionState, formData: FormData) => Promise<ProductActionState>;
  product: Product;
  categories: Category[];
  submitLabel: string;
  onSuccess: () => void;
}) {
  const [state, formAction] = useActionState(action, initialProductState);

  useEffect(() => {
    if (state.status === "success") onSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="productId" value={product.id} />

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-graphite">Nome *</span>
        <input name="name" type="text" required maxLength={120} defaultValue={product.name} className={inputClass} />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-graphite">Descrição</span>
        <textarea
          name="description"
          rows={2}
          maxLength={500}
          defaultValue={product.description ?? ""}
          className="w-full rounded-lg border border-border bg-surface-card px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-graphite">Categoria *</span>
        <select name="categoryId" required defaultValue={product.category_id} className={inputClass}>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-graphite">Preço de venda *</span>
          <input
            name="price"
            type="text"
            inputMode="decimal"
            required
            defaultValue={product.price.toFixed(2).replace(".", ",")}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-graphite">Custo de produção</span>
          <input
            name="cost"
            type="text"
            inputMode="decimal"
            defaultValue={product.cost === null ? "" : product.cost.toFixed(2).replace(".", ",")}
            className={inputClass}
          />
        </label>
      </div>

      <label className="flex items-center gap-2">
        <input type="checkbox" name="isAvailable" defaultChecked={product.is_available} className="h-4 w-4 rounded border-border" />
        <span className="text-sm font-semibold text-graphite">Disponível para venda</span>
      </label>

      {state.status === "error" && <ErrorState message={state.message ?? "Não foi possível salvar."} />}

      <SubmitButton label={submitLabel} />
    </form>
  );
}
