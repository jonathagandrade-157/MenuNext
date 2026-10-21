"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { NAV_ICONS, type NavIconName } from "./navIcons";

export type NavItem = {
  href: string;
  label: string;
  ownerOnly?: boolean;
  icon?: NavIconName;
  /** Contador ao lado do item (ex.: pedidos novos). Só aparece se > 0. */
  badge?: number;
};
export type NavGroup = { title?: string; items: NavItem[] };

// Rotas-raiz ("/painel", "/master") só ficam ativas na própria rota; as demais
// também nas subrotas (ex.: /painel/produtos/novo ativa "Produtos").
const ROOT_PATHS = new Set(["/painel", "/master"]);

function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (ROOT_PATHS.has(href)) return false;
  return pathname.startsWith(`${href}/`);
}

function NavLinks({
  groups,
  onNavigate,
}: {
  groups: NavGroup[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 overflow-y-auto px-3 pb-6" aria-label="Navegação principal">
      {groups.map((group, i) => (
        <div key={group.title ?? i} className={i > 0 ? "mt-2 border-t border-border pt-2" : ""}>
          {group.title && (
            <p className="px-3 py-2 text-label-sm uppercase tracking-wider text-text-muted">{group.title}</p>
          )}
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon ? NAV_ICONS[item.icon] : null;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 transition-colors ${
                    active
                      ? "bg-primary/10 text-label-lg font-bold text-primary"
                      : "text-label-md text-text-muted hover:bg-surface-subdued hover:text-graphite"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    {Icon && <Icon className="h-5 w-5 shrink-0" aria-hidden strokeWidth={active ? 2.25 : 1.75} />}
                    {item.label}
                  </span>
                  {item.badge && item.badge > 0 ? (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-label-sm text-white">
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  ) : active ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                  ) : null}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

/** O logo leva à home da área em que a pessoa está (painel ou master), nunca à
 * landing page pública — quem está logado não quer sair do app ao clicar nele. */
function Brand({ href, onClick }: { href: string; onClick?: () => void }) {
  return (
    <Link href={href} className="text-base font-extrabold text-graphite" onClick={onClick}>
      Menu<span className="text-primary">Next</span>
    </Link>
  );
}

/**
 * Barra superior + drawer do menu abaixo de lg (JON-7): em telas menores que
 * 1024px a navegação fixa some, então há um botão de menu que abre um drawer
 * com a navegação completa. A navegação fixa fica em PanelSideNav (painel) ou
 * PanelSidebar (master).
 */
export function PanelMobileNav({ brandLabel, groups, homeHref = "/painel" }: { brandLabel: string; groups: NavGroup[]; homeHref?: string }) {
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
        <Brand href={homeHref} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
          className="rounded-lg p-2 text-graphite hover:bg-surface-subdued"
        >
          <Menu className="h-5 w-5" aria-hidden />
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
              <Brand href={homeHref} onClick={() => setOpen(false)} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar menu"
                className="rounded-lg p-1 text-text-muted hover:bg-surface-subdued hover:text-graphite"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="px-6 py-3 text-label-sm uppercase tracking-wider text-text-muted">{brandLabel}</div>
            <NavLinks groups={groups} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}

/** Menu fixo do painel do lojista (a partir de lg): cartão arredondado como no Stitch. */
export function PanelSideNav({ groups }: { groups: NavGroup[] }) {
  return (
    <aside className="hidden w-60 shrink-0 self-start py-6 pl-6 lg:block">
      <div className="sticky top-6 flex max-h-[calc(100vh-3rem)] flex-col overflow-hidden rounded-xl bg-surface-card pt-1 shadow-card">
        <NavLinks groups={groups} />
      </div>
    </aside>
  );
}

/**
 * Sidebar completa (barra mobile + menu lateral de altura total) — usada pelo
 * painel Master. O painel do lojista usa PanelMobileNav + PanelSideNav.
 */
export function PanelSidebar({ brandLabel, groups, homeHref = "/master" }: { brandLabel: string; groups: NavGroup[]; homeHref?: string }) {
  return (
    <>
      <PanelMobileNav brandLabel={brandLabel} groups={groups} homeHref={homeHref} />
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface-card lg:flex">
        <div className="flex h-16 items-center border-b border-border px-6">
          <Brand href={homeHref} />
        </div>
        <div className="px-6 py-3 text-label-sm uppercase tracking-wider text-text-muted">{brandLabel}</div>
        <NavLinks groups={groups} />
      </aside>
    </>
  );
}
