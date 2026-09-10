"use client";

import { useRef, useState, useTransition } from "react";
import { ErrorState } from "@/components/ui/States";
import { addProductImageAction, moveProductImageAction, removeProductImageAction } from "@/lib/actions/products";
import { MAX_PRODUCT_IMAGES } from "@/lib/storage/assets";
import type { ProductImage } from "@/lib/tenant";

type ImageWithUrl = ProductImage & { url: string };

/** Grade de fotos do produto (editar): adicionar, remover, mover para os lados. */
export function ProductImagesManager({ productId, images }: { productId: string; images: ImageWithUrl[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sorted = [...images].sort((a, b) => a.display_order - b.display_order);

  function handleAdd(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setPendingId("new");
    startTransition(async () => {
      const result = await addProductImageAction(productId, file);
      setPendingId(null);
      if (!result.ok) setError(result.error ?? "Não foi possível adicionar a imagem.");
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  }

  function handleRemove(imageId: string) {
    setError(null);
    setPendingId(imageId);
    startTransition(async () => {
      const result = await removeProductImageAction(imageId);
      setPendingId(null);
      if (!result.ok) setError(result.error ?? "Não foi possível remover a imagem.");
    });
  }

  function handleMove(imageId: string, direction: "up" | "down") {
    setError(null);
    setPendingId(imageId);
    startTransition(async () => {
      const result = await moveProductImageAction(imageId, direction);
      setPendingId(null);
      if (!result.ok) setError(result.error ?? "Não foi possível reordenar.");
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-graphite">Fotos do produto</span>
        <span className="text-xs text-text-muted">
          {sorted.length}/{MAX_PRODUCT_IMAGES}
        </span>
      </div>

      <div className="flex flex-wrap gap-3">
        {sorted.map((image, index) => {
          const busy = isPending && pendingId === image.id;
          return (
            <div key={image.id} className="flex flex-col items-center gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={`Foto ${index + 1} do produto`}
                className={`h-20 w-20 rounded-lg object-cover ${index === 0 ? "ring-2 ring-primary" : "border border-border"}`}
              />
              <div className="flex items-center justify-center gap-1">
                <button
                  type="button"
                  title="Mover para a esquerda"
                  disabled={index === 0 || busy}
                  onClick={() => handleMove(image.id, "up")}
                  className="rounded p-0.5 text-xs text-text-muted hover:bg-surface-subdued disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ←
                </button>
                <button
                  type="button"
                  title="Remover foto"
                  disabled={busy}
                  onClick={() => handleRemove(image.id)}
                  className="rounded p-0.5 text-xs text-red hover:bg-red/10 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ✕
                </button>
                <button
                  type="button"
                  title="Mover para a direita"
                  disabled={index === sorted.length - 1 || busy}
                  onClick={() => handleMove(image.id, "down")}
                  className="rounded p-0.5 text-xs text-text-muted hover:bg-surface-subdued disabled:cursor-not-allowed disabled:opacity-30"
                >
                  →
                </button>
              </div>
            </div>
          );
        })}

        {sorted.length < MAX_PRODUCT_IMAGES && (
          <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-text-muted hover:border-primary hover:text-primary">
            <span className="text-xl leading-none">+</span>
            <span className="text-[10px] font-semibold">Adicionar</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleAdd}
              disabled={isPending}
              className="hidden"
            />
          </label>
        )}
      </div>

      {error && <ErrorState message={error} />}
    </div>
  );
}
