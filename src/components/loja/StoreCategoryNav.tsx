export function StoreCategoryNav({
  categories,
  hasCombos,
}: {
  categories: { id: string; name: string }[];
  hasCombos: boolean;
}) {
  if (categories.length === 0 && !hasCombos) return null;

  return (
    <nav className="sticky top-0 z-30 flex items-center gap-2 overflow-x-auto border-b border-border bg-surface-card/95 px-3.5 py-2.5 backdrop-blur-md [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {hasCombos && (
        <a
          href="#combos"
          className="shrink-0 whitespace-nowrap rounded-xl border border-border px-3.5 py-2 text-xs font-bold text-graphite hover:bg-surface-subdued"
        >
          🍱 Combos
        </a>
      )}
      {categories.map((category) => (
        <a
          key={category.id}
          href={`#categoria-${category.id}`}
          className="shrink-0 whitespace-nowrap rounded-xl border border-border px-3.5 py-2 text-xs font-bold text-graphite hover:bg-surface-subdued"
        >
          {category.name}
        </a>
      ))}
    </nav>
  );
}
