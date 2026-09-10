"use client";

import Link from "next/link";
import { useBag } from "@/contexts/BagContext";

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M12 3 3 10v11h6v-6h6v6h6V10z" />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
      <path d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
      <path
        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
      <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Navegação inferior da loja pública. Nesta fase só "Início" navega de
 * verdade: Sacola aponta para a rota já existente (ainda placeholder);
 * Pedidos/Perfil não têm rota própria ainda, então ficam presentes mas
 * inertes (não removidos, só sem destino até a fase que os implementar).
 */
export function StoreBottomNav({ slug }: { slug: string }) {
  const { totalItemCount } = useBag();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex justify-center border-t border-border bg-surface-card/95 px-3 py-2 backdrop-blur-md">
      <div className="flex w-full max-w-[420px] items-center justify-around">
        <Link href={`/loja/${slug}`} className="flex flex-1 flex-col items-center gap-1 py-1 text-primary">
          <HomeIcon />
          <span className="text-[11px] font-bold">Início</span>
        </Link>
        <Link
          href={`/loja/${slug}/sacola`}
          className="relative flex flex-1 flex-col items-center gap-1 py-1 text-text-muted hover:text-primary"
        >
          <span className="relative">
            <BagIcon />
            {totalItemCount > 0 && (
              <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-white">
                {totalItemCount}
              </span>
            )}
          </span>
          <span className="text-[11px] font-semibold">Sacola</span>
        </Link>
        <button
          type="button"
          disabled
          className="flex flex-1 flex-col items-center gap-1 py-1 text-text-muted/50"
        >
          <ReceiptIcon />
          <span className="text-[11px] font-semibold">Pedidos</span>
        </button>
        <button
          type="button"
          disabled
          className="flex flex-1 flex-col items-center gap-1 py-1 text-text-muted/50"
        >
          <UserIcon />
          <span className="text-[11px] font-semibold">Perfil</span>
        </button>
      </div>
    </nav>
  );
}
