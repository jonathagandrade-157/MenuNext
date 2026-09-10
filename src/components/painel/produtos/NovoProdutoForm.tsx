"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import { createProductAction } from "@/lib/actions/products";
import { MAX_PRODUCT_IMAGES } from "@/lib/storage/assets";
import { initialProductState } from "@/lib/form-state";
import type { Category } from "@/lib/tenant";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" loading={pending} disabled={pending}>
      {pending ? "Salvando..." : "Salvar produto"}
    </Button>
  );
}

const inputClass =
  "h-11 w-full rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

export function NovoProdutoForm({ categories }: { categories: Category[] }) {
  const [state, formAction] = useActionState(createProductAction, initialProductState);
  const [previews, setPreviews] = useState<string[]>([]);

  useEffect(() => {
    return () => {
      previews.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    previews.forEach((url) => URL.revokeObjectURL(url));
    const files = Array.from(e.target.files ?? []).slice(0, MAX_PRODUCT_IMAGES);
    setPreviews(files.map((file) => URL.createObjectURL(file)));
  }

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-graphite">Fotos do produto</label>
        <p className="mb-2 text-xs text-text-muted">
          Até {MAX_PRODUCT_IMAGES} fotos (JPEG, PNG ou WebP, 5 MB cada). A primeira será a capa do produto.
        </p>
        <input
          type="file"
          name="images"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={handleFilesChange}
          className="block w-full text-sm text-text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary hover:file:bg-primary/20"
        />
        {previews.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {previews.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={src}
                src={src}
                alt={`Prévia ${i + 1}`}
                className={`h-16 w-16 rounded-lg object-cover ${i === 0 ? "ring-2 ring-primary" : "border border-border"}`}
              />
            ))}
          </div>
        )}
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-graphite">Nome do produto *</span>
        <input name="name" type="text" required maxLength={120} placeholder="Ex.: Pizza Calabresa" className={inputClass} />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-graphite">Descrição</span>
        <textarea
          name="description"
          rows={3}
          maxLength={500}
          placeholder="Ex.: Molho de tomate, calabresa fatiada e cebola"
          className="w-full rounded-lg border border-border bg-surface-card px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-graphite">Categoria *</span>
        <select name="categoryId" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Selecione uma categoria
          </option>
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
          <input name="price" type="text" inputMode="decimal" required placeholder="0,00" className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-graphite">Custo de produção</span>
          <input name="cost" type="text" inputMode="decimal" placeholder="0,00" className={inputClass} />
        </label>
      </div>
      <p className="-mt-3 text-xs text-text-muted">
        O custo é interno e nunca aparece na loja pública — usado futuramente para análises de margem.
      </p>

      <label className="flex items-center gap-2">
        <input type="checkbox" name="isAvailable" defaultChecked className="h-4 w-4 rounded border-border" />
        <span className="text-sm font-semibold text-graphite">Disponível para venda</span>
      </label>

      {state.status === "error" && <ErrorState message={state.message ?? "Não foi possível salvar."} />}

      <SubmitButton />
    </form>
  );
}
