"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBag } from "@/contexts/BagContext";
import { BAG_ITEM_QUANTITY_MAX, validateBagItemQuantity } from "@/lib/bag";
import { formatCurrencyBRL } from "@/lib/store";

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
      <path d="M4 7h16M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2m2 0-1 13a2 2 0 01-2 2H8a2 2 0 01-2-2L5 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EmptyBagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-12 w-12">
      <path d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SacolaClient({ slug, canCheckout, unavailableReason }: { slug: string; canCheckout: boolean; unavailableReason: string | null }) {
  const router = useRouter();
  const { items, removeItem, updateItemQuantity, totalPrice } = useBag();

  if (items.length === 0) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="text-text-muted">
          <EmptyBagIcon />
        </span>
        <h1 className="text-lg font-extrabold text-graphite">Sua sacola está vazia</h1>
        <p className="max-w-xs text-sm text-text-muted">Adicione itens do cardápio para começar seu pedido.</p>
        <Link href={`/loja/${slug}`} className="text-sm font-semibold text-primary hover:underline">
          ← Ver cardápio
        </Link>
      </div>
    );
  }

  return (
    <div className="pb-40">
      <div className="sticky top-0 z-20 flex items-center gap-2 bg-surface-card/95 px-3.5 py-3 backdrop-blur-md">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Voltar"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-graphite hover:bg-surface-subdued"
        >
          ←
        </button>
        <span className="text-sm font-bold text-graphite">Sacola</span>
      </div>

      {!canCheckout && unavailableReason && (
        <div className="mx-3.5 mt-3 rounded-xl border border-border bg-surface-subdued px-3.5 py-2.5 text-xs font-medium text-text-muted">
          {unavailableReason}
        </div>
      )}

      <div className="space-y-3 px-3.5 py-4">
        {items.map((item) => {
          const quantityValidation = validateBagItemQuantity(item.quantity + 1);
          return (
            <div key={item.key} className="flex gap-3 rounded-2xl border border-border bg-surface-card p-3">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-surface-subdued">
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-bold text-graphite">{item.name}</h3>
                  <button
                    type="button"
                    onClick={() => removeItem(item.key)}
                    aria-label={`Remover ${item.name}`}
                    className="shrink-0 text-text-muted hover:text-red"
                  >
                    <TrashIcon />
                  </button>
                </div>
                {item.selectedAddons.length > 0 && (
                  <p className="text-xs text-text-muted">{item.selectedAddons.map((a) => a.name).join(", ")}</p>
                )}
                {item.observation && <p className="text-xs italic text-text-muted">&ldquo;{item.observation}&rdquo;</p>}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2 rounded-lg border border-border p-0.5">
                    <button
                      type="button"
                      onClick={() => updateItemQuantity(item.key, item.quantity - 1)}
                      disabled={item.quantity <= 1}
                      className="flex h-6 w-6 items-center justify-center rounded text-graphite hover:bg-surface-subdued disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      −
                    </button>
                    <span className="w-5 text-center text-xs font-bold text-graphite">{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() => updateItemQuantity(item.key, item.quantity + 1)}
                      disabled={item.quantity >= BAG_ITEM_QUANTITY_MAX || !quantityValidation.ok}
                      className="flex h-6 w-6 items-center justify-center rounded text-graphite hover:bg-surface-subdued disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-sm font-extrabold text-graphite">{formatCurrencyBRL(item.subtotal)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center border-t border-border bg-surface-card px-3.5 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
        <div className="w-full max-w-[420px] space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-text-muted">Subtotal</span>
            <span className="font-bold text-graphite">{formatCurrencyBRL(totalPrice)}</span>
          </div>
          <p className="text-[11px] text-text-muted">Taxa de entrega (se houver) é calculada no checkout.</p>
          <button
            type="button"
            disabled={!canCheckout}
            onClick={() => router.push(`/loja/${slug}/checkout`)}
            className="flex h-12 w-full items-center justify-between rounded-xl bg-primary px-4 text-sm font-bold text-white shadow-[0_8px_20px_-4px_rgba(249,87,33,0.35)] transition-all hover:bg-[#ff5436] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>Ir para o checkout</span>
            <span>{formatCurrencyBRL(totalPrice)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
