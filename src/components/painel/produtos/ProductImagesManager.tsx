"use client";

import { useRef, useState, useTransition } from "react";
import { ErrorState } from "@/components/ui/States";
import {
  addProductImageAction,
  moveProductImageAction,
  removeProductImageAction,
  setPrimaryProductImageAction,
} from "@/lib/actions/products";
import { MAX_PRODUCT_IMAGES } from "@/lib/storage/assets";
import type { ProductImage } from "@/lib/tenant";

type ImageWithUrl = ProductImage & { url: string };

/**
 * Galeria de fotos do produto (editar) — adicionar, remover, mover e
 * definir principal. A principal é sempre a primeira depois de ordenar por
 * display_order (nunca um campo separado); adicionar nunca reocupa o slot
 * dela por acidente (ver nextProductImageDisplayOrder em
 * src/lib/productImages.ts) e excluí-la promove a próxima automaticamente,
 * só por ordenação — nenhum estado local a mais aqui.
 */
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

  function handleSetPrimary(imageId: string) {
    setError(null);
    setPendingId(imageId);
    startTransition(async () => {
      const result = await setPrimaryProductImageAction(imageId);
      setPendingId(null);
      if (!result.ok) setError(result.error ?? "Não foi possível definir como principal.");
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-graphite">Imagens do produto</span>
        <span className="text-xs text-text-muted">
          {sorted.length}/{MAX_PRODUCT_IMAGES}
        </span>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        {sorted.map((image, index) => {
          const busy = isPending && pendingId === image.id;
          const isPrimary = index === 0;
          return (
            <div key={image.id} className="flex flex-col items-center gap-1.5">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={isPrimary ? "Foto principal do produto" : `Foto ${index + 1} do produto`}
                  className={`object-cover ${
                    isPrimary
                      ? "h-24 w-24 rounded-xl ring-2 ring-primary"
                      : "h-20 w-20 rounded-lg border border-border"
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

              {!isPrimary && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleSetPrimary(image.id)}
                  className="text-[10px] font-bold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Definir como principal
                </button>
              )}
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
