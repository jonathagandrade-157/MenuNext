"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useBag } from "@/contexts/BagContext";
import { formatCurrencyBRL } from "@/lib/store";

/** Sacola fixa ao lado do cardápio no desktop (a partir de lg): o cliente vê
 * o que já escolheu enquanto navega, como nos apps de delivery. No celular
 * ela não aparece — lá vale a barra flutuante. */
export function StoreBagAside({ slug }: { slug: string }) {
  const { items, totalItemCount, totalPrice } = useBag();

  return (
    <aside className="hidden lg:sticky lg:top-4 lg:mt-4 lg:mr-4 lg:block">
      <div className="rounded-2xl border border-border bg-surface-card p-4 shadow-card">
        <div className="flex items-center gap-2">
          <ShoppingBag className="h-5 w-5 text-primary" aria-hidden />
          <h2 className="text-body-lg font-bold text-graphite">Sua sacola</h2>
          {totalItemCount > 0 && (
            <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-label-sm text-primary">
              {totalItemCount} {totalItemCount === 1 ? "item" : "itens"}
            </span>
          )}
        </div>

        {items.length === 0 ? (
          <p className="mt-3 text-body-sm text-text-muted">Escolha itens do cardápio para montar seu pedido.</p>
        ) : (
          <>
            <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto">
              {items.map((item) => (
                <li key={item.key} className="flex justify-between gap-2 text-body-sm">
                  <span className="min-w-0 text-graphite">
                    <span className="font-semibold">{item.quantity}x</span> {item.name}
                  </span>
                  <span className="shrink-0 text-graphite">{formatCurrencyBRL(item.subtotal)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
              <span className="text-label-lg text-text-muted">Subtotal</span>
              <span className="text-headline-sm text-graphite">{formatCurrencyBRL(totalPrice)}</span>
            </div>
            <Link
              href={`/loja/${slug}/sacola`}
              className="mt-3 flex h-11 w-full items-center justify-center rounded-xl bg-primary text-label-lg text-white shadow-[0_8px_20px_-4px_rgba(171,47,0,0.35)] transition-colors hover:bg-primary-container"
            >
              Ver sacola
            </Link>
          </>
        )}
      </div>
    </aside>
  );
}
