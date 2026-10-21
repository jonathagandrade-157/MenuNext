"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { useBag } from "@/contexts/BagContext";
import { BAG_ITEM_QUANTITY_MAX, validateBagItemQuantity } from "@/lib/bag";
import { formatCurrencyBRL } from "@/lib/store";

export function SacolaClient({ slug, canCheckout, unavailableReason }: { slug: string; canCheckout: boolean; unavailableReason: string | null }) {
  const router = useRouter();
  const { items, removeItem, updateItemQuantity, clearBag, totalItemCount, totalPrice } = useBag();

  if (items.length === 0) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ShoppingBag className="h-8 w-8" aria-hidden />
        </span>
        <h1 className="text-headline-sm text-graphite">Sua sacola está vazia</h1>
        <p className="max-w-xs text-body-md text-text-muted">Adicione itens do cardápio para começar seu pedido.</p>
        <Link href={`/loja/${slug}`} className="text-label-lg text-primary hover:underline">
          Ver cardápio
        </Link>
      </div>
    );
  }

  return (
    <div className="pb-40">
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-surface-card/95 px-3.5 py-3 backdrop-blur-md">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Voltar"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-graphite hover:bg-surface-subdued"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
        <h1 className="flex-1 text-headline-sm text-graphite">
          Minha sacola{" "}
          <span className="text-body-md font-normal text-text-muted">
            ({totalItemCount} {totalItemCount === 1 ? "item" : "itens"})
          </span>
        </h1>
        <button type="button" onClick={clearBag} className="text-label-md text-text-muted hover:text-red">
          Limpar
        </button>
      </div>

      {!canCheckout && unavailableReason && (
        <div className="mx-3.5 mt-3 rounded-xl border border-border bg-surface-subdued px-3.5 py-2.5 text-xs font-medium text-text-muted">
          {unavailableReason}
        </div>
      )}

      <div className="grid gap-3 px-3.5 py-4 md:grid-cols-2">
        {items.map((item) => {
          const quantityValidation = validateBagItemQuantity(item.quantity + 1);
          return (
            <div key={item.key} className="flex gap-3 rounded-2xl border border-border bg-surface-card p-3 shadow-card">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-surface-subdued">
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-body-md font-bold text-graphite">{item.name}</h3>
                  <button
                    type="button"
                    onClick={() => removeItem(item.key)}
                    aria-label={`Remover ${item.name}`}
                    className="shrink-0 text-text-muted hover:text-red"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                {item.selectedAddons.length > 0 && (
                  <ul className="text-body-sm text-text-muted">
                    {item.selectedAddons.map((a) => (
                      <li key={`${a.groupId}-${a.addonId}`}>
                        + {a.name}
                        {a.price > 0 && ` (${formatCurrencyBRL(a.price)})`}
                      </li>
                    ))}
                  </ul>
                )}
                {item.observation && <p className="text-body-sm italic text-text-muted">&ldquo;{item.observation}&rdquo;</p>}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2 rounded-lg border border-border p-0.5">
                    <button
                      type="button"
                      onClick={() => updateItemQuantity(item.key, item.quantity - 1)}
                      disabled={item.quantity <= 1}
                      aria-label="Diminuir quantidade"
                      className="flex h-7 w-7 items-center justify-center rounded text-graphite hover:bg-surface-subdued disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Minus className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <span className="w-5 text-center text-label-lg text-graphite">{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() => updateItemQuantity(item.key, item.quantity + 1)}
                      disabled={item.quantity >= BAG_ITEM_QUANTITY_MAX || !quantityValidation.ok}
                      aria-label="Aumentar quantidade"
                      className="flex h-7 w-7 items-center justify-center rounded text-graphite hover:bg-surface-subdued disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                  <span className="text-body-md font-bold text-graphite">{formatCurrencyBRL(item.subtotal)}</span>
                </div>
              </div>
            </div>
          );
        })}

        <Link
          href={`/loja/${slug}`}
          className="flex h-11 w-full items-center justify-center md:col-span-2 gap-1.5 rounded-xl border border-dashed border-border text-label-lg text-primary hover:bg-surface-subdued"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Adicionar mais itens
        </Link>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center border-t border-border bg-surface-card px-3.5 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
        <div className="w-full max-w-3xl space-y-2 lg:max-w-5xl">
          <div className="flex items-center justify-between text-sm">
            <span className="text-label-lg text-text-muted">Subtotal</span>
            <span className="text-headline-sm text-graphite">{formatCurrencyBRL(totalPrice)}</span>
          </div>
          <p className="text-label-sm font-normal text-text-muted">Taxa de entrega (se houver) é calculada no checkout.</p>
          <button
            type="button"
            disabled={!canCheckout}
            onClick={() => router.push(`/loja/${slug}/checkout`)}
            className="flex h-12 w-full items-center justify-between rounded-xl bg-primary md:ml-auto md:w-96 px-4 text-sm font-bold text-white shadow-[0_8px_20px_-4px_rgba(171,47,0,0.35)] transition-all hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>Ir para o checkout</span>
            <span>{formatCurrencyBRL(totalPrice)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
