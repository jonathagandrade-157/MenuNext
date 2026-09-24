"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export type NavItem = { href: string; label: string; ownerOnly?: boolean };
export type NavGroup = { title?: string; items: NavItem[] };

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
      <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NavLinks({
  groups,
  onNavigate,
}: {
  groups: NavGroup[];
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-6">
      {groups.map((group, i) => (
        <div key={group.title ?? i} className="space-y-1">
          {group.title && (
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">{group.title}</p>
          )}
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className="block rounded-lg px-3 py-2 text-sm font-medium text-text-muted hover:bg-surface-subdued hover:text-graphite"
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

/**
 * Sidebar do painel/master (JON-7). Antes só existia a versão fixa
 * (`hidden ... lg:flex`) — em telas menores que 1024px ela some por
 * completo e não havia nenhum jeito alternativo de navegar, deixando o
 * painel praticamente inutilizável no celular. Abaixo de lg agora há uma
 * barra com botão de menu que abre um drawer (mesmo padrão visual de
 * overlay+painel do componente Modal) com a navegação completa; a sidebar
 * fixa continua exatamente igual a partir de lg.
 */
export function PanelSidebar({
  brandLabel,
  groups,
}: {
  brandLabel: string;
  groups: NavGroup[];
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <>
      <div className="flex h-14 items-center justify-between border-b border-border bg-surface-card px-4 lg:hidden">
        <Link href="/" className="text-base font-extrabold text-graphite">
          Menu<span className="text-primary">Next</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
          className="rounded-lg p-2 text-graphite hover:bg-surface-subdued"
        >
          <MenuIcon />
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-graphite/40"
          />
          <aside className="relative flex h-full w-72 max-w-[85vw] flex-col bg-surface-card shadow-[var(--shadow-modal)]">
            <div className="flex h-16 items-center justify-between border-b border-border px-6">
              <Link href="/" className="text-base font-extrabold text-graphite" onClick={() => setOpen(false)}>
                Menu<span className="text-primary">Next</span>
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar menu"
                className="rounded-lg p-1 text-text-muted hover:bg-surface-subdued hover:text-graphite"
              >
                ✕
              </button>
            </div>
            <div className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">{brandLabel}</div>
            <NavLinks groups={groups} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface-card lg:flex">
        <div className="flex h-16 items-center border-b border-border px-6">
          <Link href="/" className="text-base font-extrabold text-graphite">
            Menu<span className="text-primary">Next</span>
          </Link>
        </div>
        <div className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">{brandLabel}</div>
        <NavLinks groups={groups} />
      </aside>
    </>
  );
}
