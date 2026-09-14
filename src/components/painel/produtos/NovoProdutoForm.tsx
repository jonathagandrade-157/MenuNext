"use client";

import { useActionState, useEffect, useRef, useState } from "react";
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

type StagedImage = { id: string; file: File; previewUrl: string };

export function NovoProdutoForm({ categories }: { categories: Category[] }) {
  const [state, formAction] = useActionState(createProductAction, initialProductState);
  const [staged, setStaged] = useState<StagedImage[]>([]);
  const pickerInputRef = useRef<HTMLInputElement>(null);
  const submitInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      staged.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // O <input type="file"> nativo SUBSTITUI a seleção anterior a cada nova
  // escolha — é por isso que "adicionar a segunda foto" parecia apagar a
  // primeira. `staged` acumula as escolhas em estado do React; este efeito
  // espelha `staged` para o único <input> real que de fato viaja no
  // <form>, via DataTransfer (única forma de atribuir um FileList
  // programaticamente).
  useEffect(() => {
    if (!submitInputRef.current) return;
    const dataTransfer = new DataTransfer();
    staged.forEach((image) => dataTransfer.items.add(image.file));
    submitInputRef.current.files = dataTransfer.files;
  }, [staged]);

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    setStaged((prev) => {
      const room = Math.max(0, MAX_PRODUCT_IMAGES - prev.length);
      const additions = picked.slice(0, room).map((file) => ({
        id: `${file.name}-${file.lastModified}-${file.size}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      return [...prev, ...additions];
    });
    if (pickerInputRef.current) pickerInputRef.current.value = "";
  }

  function handleRemove(id: string) {
    setStaged((prev) => {
      const target = prev.find((image) => image.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((image) => image.id !== id);
    });
  }

  function handleMove(id: string, direction: "left" | "right") {
    setStaged((prev) => {
      const index = prev.findIndex((image) => image.id === id);
      const swapWith = direction === "left" ? index - 1 : index + 1;
      if (index === -1 || swapWith < 0 || swapWith >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      return next;
    });
  }

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-graphite">Imagens do produto</label>
        <p className="mb-2 text-xs text-text-muted">
          Até {MAX_PRODUCT_IMAGES} fotos (JPEG, PNG ou WebP, 5 MB cada). A primeira é a foto principal.
        </p>

        {/* Input real que viaja no submit — nunca visível/escolhido direto pelo lojista. */}
        <input ref={submitInputRef} type="file" name="images" multiple className="hidden" />

        <div className="flex flex-wrap items-start gap-3">
          {staged.map((image, index) => {
            const isPrimary = index === 0;
            return (
              <div key={image.id} className="flex flex-col items-center gap-1.5">
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.previewUrl}
                    alt={isPrimary ? "Prévia da foto principal" : `Prévia ${index + 1}`}
                    className={`object-cover ${
                      isPrimary ? "h-24 w-24 rounded-xl ring-2 ring-primary" : "h-20 w-20 rounded-lg border border-border"
                    }`}
                  />
                  {isPrimary && (
                    <span className="absolute -top-1.5 -left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] text-white shadow-sm">
                      ★
                    </span>
                  )}
                </div>
                <span className={`text-[10px] font-bold ${isPrimary ? "text-primary" : "text-text-muted"}`}>
                  {isPrimary ? "Principal" : `Foto ${index + 1}`}
                </span>
                <div className="flex items-center justify-center gap-1">
                  <button
                    type="button"
                    title="Mover para a esquerda"
                    disabled={index === 0}
                    onClick={() => handleMove(image.id, "left")}
                    className="rounded p-0.5 text-xs text-text-muted hover:bg-surface-subdued disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    title="Remover"
                    onClick={() => handleRemove(image.id)}
                    className="rounded p-0.5 text-xs text-red hover:bg-red/10"
                  >
                    ✕
                  </button>
                  <button
                    type="button"
                    title="Mover para a direita"
                    disabled={index === staged.length - 1}
                    onClick={() => handleMove(image.id, "right")}
                    className="rounded p-0.5 text-xs text-text-muted hover:bg-surface-subdued disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    →
                  </button>
                </div>
              </div>
            );
          })}

          {staged.length < MAX_PRODUCT_IMAGES && (
            <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-text-muted hover:border-primary hover:text-primary">
              <span className="text-xl leading-none">+</span>
              <span className="text-[10px] font-semibold">Adicionar</span>
              <input
                ref={pickerInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={handlePick}
                className="hidden"
              />
            </label>
          )}
        </div>
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
