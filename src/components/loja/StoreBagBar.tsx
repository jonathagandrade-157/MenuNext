"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useBag } from "@/contexts/BagContext";
import { formatCurrencyBRL } from "@/lib/store";

/** Barra flutuante "Ver sacola" no celular: aparece quando há itens, logo
 * acima do menu inferior, para o cliente fechar o pedido sem procurar a aba. */
export function StoreBagBar({ slug }: { slug: string }) {
  const { totalItemCount, totalPrice } = useBag();
  if (totalItemCount === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-[68px] z-40 flex justify-center px-3.5 lg:hidden">
      <Link
        href={`/loja/${slug}/sacola`}
        className="flex h-12 w-full max-w-3xl items-center justify-between rounded-xl bg-primary px-4 text-white shadow-[0_8px_20px_-4px_rgba(171,47,0,0.45)] transition-colors hover:bg-primary-container"
      >
        <span className="flex items-center gap-2 text-label-lg">
          <span className="relative">
            <ShoppingBag className="h-5 w-5" aria-hidden />
            <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-primary">
              {totalItemCount}
            </span>
          </span>
          <span className="pl-1">Ver sacola</span>
        </span>
        <span className="text-label-lg">{formatCurrencyBRL(totalPrice)}</span>
      </Link>
    </div>
  );
}
