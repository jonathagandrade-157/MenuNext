import Link from "next/link";
import { ExternalLink, LogOut, Store } from "lucide-react";
import { signOutAction } from "@/lib/actions/auth";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * Faixa de identidade da loja (Stitch): logo, nome, local, situação, atalho
 * "Ver como cliente" e dados de quem está logado. Só mostra dado real — sem
 * sino de notificações nem "realtime ativo", que não têm funcionalidade
 * por trás.
 */
export function PanelTopbar({
  storeName,
  storeSlug,
  storeLocation,
  logoUrl,
  isOpen = true,
  userName,
  roleLabel,
}: {
  storeName: string;
  storeSlug?: string;
  storeLocation?: string | null;
  logoUrl?: string | null;
  isOpen?: boolean;
  userName?: string | null;
  roleLabel?: string;
}) {
  return (
    <div className="border-b border-border bg-surface-card shadow-card">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10 text-primary">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- logo do Storage já otimizado (WebP 512 px)
              <img src={logoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <Store className="h-5 w-5" aria-hidden />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2">
              <h2 className="truncate text-headline-sm text-graphite">{storeName}</h2>
              {storeLocation && <span className="text-body-sm text-text-muted">· {storeLocation}</span>}
            </div>
            <span
              className={`mt-0.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-label-sm ${
                isOpen ? "bg-emerald/10 text-emerald" : "bg-surface-subdued text-text-muted"
              }`}
            >
              {isOpen && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald" aria-hidden />}
              {isOpen ? "Loja Aberta" : "Loja Fechada"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {storeSlug && (
            <Link
              href={`/loja/${storeSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl bg-surface-subdued px-3 py-2 text-label-md text-graphite transition-colors hover:bg-border"
            >
              <Store className="h-4 w-4 text-primary" aria-hidden />
              Ver como cliente
              <ExternalLink className="h-3.5 w-3.5 text-text-muted" aria-hidden />
            </Link>
          )}
          {userName && (
            <div className="flex items-center gap-2 pl-1">
              <div
                aria-hidden
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-subdued text-label-md font-bold text-primary"
              >
                {initialsOf(userName)}
              </div>
              <div className="hidden flex-col leading-tight sm:flex">
                <span className="text-label-md text-graphite">{userName}</span>
                {roleLabel && <span className="text-body-sm text-text-muted">{roleLabel}</span>}
              </div>
            </div>
          )}
          <form action={signOutAction}>
            <button
              type="submit"
              aria-label="Sair"
              title="Sair"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-surface-subdued hover:text-graphite"
            >
              <LogOut className="h-4.5 w-4.5" aria-hidden />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
