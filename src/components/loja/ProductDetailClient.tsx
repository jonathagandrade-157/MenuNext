"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useBag } from "@/contexts/BagContext";
import {
  BAG_ITEM_OBSERVATION_MAX_LENGTH,
  BAG_ITEM_QUANTITY_MAX,
  calculateItemSubtotal,
  createBagItem,
  validateAllGroupsSelection,
  validateBagItemQuantity,
  type BagSelectedAddon,
} from "@/lib/bag";
import { formatCurrencyBRL, type PublicProductDetail } from "@/lib/store";
import { StoreAddonGroupSelector } from "./StoreAddonGroupSelector";

function ImagePlaceholderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-10 w-10">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="9" r="1.5" />
      <path d="m21 15-5-5-9 9" />
    </svg>
  );
}

export function ProductDetailClient({
  product,
  canAddToBag,
  unavailableReason,
}: {
  product: PublicProductDetail;
  canAddToBag: boolean;
  unavailableReason: string | null;
}) {
  const router = useRouter();
  const { addItem } = useBag();

  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [observation, setObservation] = useState("");
  const [activeImage, setActiveImage] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const touchStartX = useRef<number | null>(null);

  const hasGallery = product.images.length > 1;

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  }

  // Troca de imagem por swipe (mobile) — a galeria de miniaturas cobre o
  // clique no desktop; aqui é só o gesto de arrastar o dedo na foto
  // principal. Limite de 40px evita trocar com um toque acidental.
  function handleTouchEnd(e: React.TouchEvent) {
    const startX = touchStartX.current;
    touchStartX.current = null;
    if (startX === null) return;
    const deltaX = (e.changedTouches[0]?.clientX ?? startX) - startX;
    const SWIPE_THRESHOLD_PX = 40;
    if (deltaX > SWIPE_THRESHOLD_PX) {
      setActiveImage((i) => Math.max(0, i - 1));
    } else if (deltaX < -SWIPE_THRESHOLD_PX) {
      setActiveImage((i) => Math.min(product.images.length - 1, i + 1));
    }
  }

  const selectedAddons = useMemo<BagSelectedAddon[]>(() => {
    const result: BagSelectedAddon[] = [];
    for (const group of product.addonGroups) {
      for (const addonId of selections[group.id] ?? []) {
        const addon = group.addons.find((a) => a.id === addonId);
        if (addon) result.push({ groupId: group.id, addonId: addon.id, name: addon.name, price: addon.price });
      }
    }
    return result;
  }, [product.addonGroups, selections]);

  const groupsValidation = validateAllGroupsSelection(product.addonGroups, selections);
  const quantityValidation = validateBagItemQuantity(quantity);
  const canSubmit = canAddToBag && product.is_available && groupsValidation.ok && quantityValidation.ok;

  const subtotal = calculateItemSubtotal(product.price, selectedAddons, quantity);
  const cover = product.images[activeImage] ?? product.images[0];

  function handleAddToBag() {
    setSubmitError(null);
    if (!canAddToBag) {
      setSubmitError(unavailableReason ?? "Não é possível adicionar itens agora.");
      return;
    }
    if (!product.is_available) {
      setSubmitError("Este produto está indisponível no momento.");
      return;
    }
    if (!groupsValidation.ok) {
      setSubmitError(groupsValidation.error);
      return;
    }
    if (!quantityValidation.ok) {
      setSubmitError(quantityValidation.error);
      return;
    }

    const item = createBagItem({
      productId: product.id,
      name: product.name,
      basePrice: product.price,
      imageUrl: product.images[0]?.url ?? null,
      quantity,
      observation,
      selectedAddons,
    });
    addItem(item);
    router.back();
  }

  return (
    <div className="pb-28">
      <div className="sticky top-0 z-20 flex items-center gap-2 bg-surface-card/95 px-3.5 py-3 backdrop-blur-md">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Voltar"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-graphite hover:bg-surface-subdued"
        >
          ←
        </button>
        <span className="truncate text-sm font-bold text-graphite">{product.name}</span>
      </div>

      <div
        className="aspect-square w-full overflow-hidden bg-surface-subdued"
        onTouchStart={hasGallery ? handleTouchStart : undefined}
        onTouchEnd={hasGallery ? handleTouchEnd : undefined}
      >
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover.url} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-text-muted">
            <ImagePlaceholderIcon />
          </div>
        )}
      </div>

      {hasGallery && (
        <>
          {/* Mobile: indicadores de posição (troca é por swipe na foto principal). */}
          <div className="flex justify-center gap-1.5 py-2.5 sm:hidden">
            {product.images.map((image, index) => (
              <span
                key={image.url}
                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                  index === activeImage ? "bg-primary" : "bg-border"
                }`}
              />
            ))}
          </div>

          {/* Desktop: miniaturas clicáveis. */}
          <div className="hidden gap-2 overflow-x-auto px-3.5 py-2.5 sm:flex">
            {product.images.map((image, index) => (
              <button
                key={image.url}
                type="button"
                onClick={() => setActiveImage(index)}
                className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 ${
                  index === activeImage ? "border-primary" : "border-transparent"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt={`${product.name} ${index + 1}`} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </>
      )}

      <div className="space-y-4 px-3.5 py-4">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-lg font-extrabold text-graphite">{product.name}</h1>
            {!product.is_available && (
              <span className="shrink-0 rounded-full bg-red/10 px-2.5 py-1 text-[11px] font-bold text-red">
                Indisponível
              </span>
            )}
          </div>
          {product.description && <p className="mt-1 text-sm text-text-muted">{product.description}</p>}
          <p className="mt-2 text-xl font-black text-graphite">{formatCurrencyBRL(product.price)}</p>
        </div>

        {!canAddToBag && unavailableReason && (
          <div className="rounded-xl border border-border bg-surface-subdued px-3.5 py-2.5 text-xs font-medium text-text-muted">
            {unavailableReason}
          </div>
        )}

        {product.addonGroups.length > 0 && (
          <div className="space-y-4">
            {product.addonGroups.map((group) => (
              <StoreAddonGroupSelector
                key={group.id}
                group={group}
                selectedIds={selections[group.id] ?? []}
                onChange={(ids) => setSelections((prev) => ({ ...prev, [group.id]: ids }))}
              />
            ))}
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-bold text-graphite" htmlFor="observation">
            Observação
          </label>
          <textarea
            id="observation"
            value={observation}
            onChange={(e) => setObservation(e.target.value.slice(0, BAG_ITEM_OBSERVATION_MAX_LENGTH))}
            maxLength={BAG_ITEM_OBSERVATION_MAX_LENGTH}
            rows={2}
            placeholder="Ex.: sem cebola, ponto da carne, etc."
            className="w-full rounded-xl border border-border bg-surface-card px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
          />
          <p className="mt-1 text-right text-[11px] text-text-muted">
            {observation.length}/{BAG_ITEM_OBSERVATION_MAX_LENGTH}
          </p>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-graphite">Quantidade</span>
          <div className="flex items-center gap-3 rounded-xl border border-border p-1">
            <button
              type="button"
              disabled={quantity <= 1}
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-graphite hover:bg-surface-subdued disabled:cursor-not-allowed disabled:opacity-40"
            >
              −
            </button>
            <span className="w-6 text-center text-sm font-bold text-graphite">{quantity}</span>
            <button
              type="button"
              disabled={quantity >= BAG_ITEM_QUANTITY_MAX}
              onClick={() => setQuantity((q) => Math.min(BAG_ITEM_QUANTITY_MAX, q + 1))}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-graphite hover:bg-surface-subdued disabled:cursor-not-allowed disabled:opacity-40"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center border-t border-border bg-surface-card px-3.5 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
        <div className="w-full max-w-[420px] space-y-2">
          {submitError && <p className="text-center text-xs font-semibold text-red">{submitError}</p>}
          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleAddToBag}
            className="flex h-12 w-full items-center justify-between rounded-xl bg-primary px-4 text-sm font-bold text-white shadow-[0_8px_20px_-4px_rgba(249,87,33,0.35)] transition-all hover:bg-[#ff5436] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>Adicionar à sacola</span>
            <span>{formatCurrencyBRL(subtotal)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
