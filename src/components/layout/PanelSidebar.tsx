import Link from "next/link";

export type NavItem = { href: string; label: string };
export type NavGroup = { title?: string; items: NavItem[] };

export function PanelSidebar({
  brandLabel,
  groups,
}: {
  brandLabel: string;
  groups: NavGroup[];
}) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface-card lg:flex">
      <div className="flex h-16 items-center border-b border-border px-6">
        <Link href="/" className="text-base font-extrabold text-graphite">
          Menu<span className="text-primary">Next</span>
        </Link>
      </div>
      <div className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">{brandLabel}</div>
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
                className="block rounded-lg px-3 py-2 text-sm font-medium text-text-muted hover:bg-surface-subdued hover:text-graphite"
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
