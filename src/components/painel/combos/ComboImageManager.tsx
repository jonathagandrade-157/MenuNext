"use client";

import { useRef, useState, useTransition } from "react";
import { ErrorState } from "@/components/ui/States";
import { removeComboImageAction, uploadComboImageAction } from "@/lib/actions/combos";

/** Imagem única do combo (não é galeria): selecionar, pré-visualizar, substituir, remover. */
export function ComboImageManager({ comboId, imageUrl }: { comboId: string; imageUrl: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    startTransition(async () => {
      const result = await uploadComboImageAction(comboId, file);
      if (!result.ok) setError(result.error ?? "Não foi possível salvar a imagem.");
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  }

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const result = await removeComboImageAction(comboId);
      if (!result.ok) setError(result.error ?? "Não foi possível remover a imagem.");
    });
  }

  return (
    <div className="space-y-2">
      <span className="block text-sm font-semibold text-graphite">Imagem</span>
      <div className="flex items-center gap-3">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="Imagem do combo" className="h-16 w-16 rounded-lg object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-surface-subdued text-xs text-text-muted">
            Sem foto
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="cursor-pointer text-xs font-semibold text-primary hover:underline">
            {imageUrl ? "Substituir" : "Selecionar imagem"}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleChange}
              disabled={isPending}
              className="hidden"
            />
          </label>
          {imageUrl && (
            <button
              type="button"
              disabled={isPending}
              onClick={handleRemove}
              className="text-left text-xs font-semibold text-red hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              Remover
            </button>
          )}
        </div>
      </div>
      {error && <ErrorState message={error} />}
    </div>
  );
}
