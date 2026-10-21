"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { PublicCategoryWithProducts, PublicCombo } from "@/lib/store";
import { StoreComboCard } from "./StoreComboCard";
import { StoreProductCard } from "./StoreProductCard";

/** Cardápio público: busca por nome/descrição, atalhos de categoria com a
 * seção visível em destaque e as seções de combos e produtos. Só filtra o que
 * já veio do servidor — nenhum dado novo. */
export function StoreCatalog({
  slug,
  categories,
  combos,
}: {
  slug: string;
  categories: PublicCategoryWithProducts[];
  combos: PublicCombo[];
}) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const term = query.trim().toLowerCase();

  const visibleCombos = useMemo(
    () =>
      term
        ? combos.filter((c) => c.name.toLowerCase().includes(term) || (c.description ?? "").toLowerCase().includes(term))
        : combos,
    [combos, term]
  );

  const visibleCategories = useMemo(
    () =>
      categories
        .map((category) => ({
          ...category,
          products: term
            ? category.products.filter(
                (p) => p.name.toLowerCase().includes(term) || (p.description ?? "").toLowerCase().includes(term)
              )
            : category.products,
        }))
        .filter((category) => category.products.length > 0),
    [categories, term]
  );

  const sectionIds = useMemo(
    () => [...(visibleCombos.length > 0 ? ["combos"] : []), ...visibleCategories.map((c) => `categoria-${c.id}`)],
    [visibleCombos.length, visibleCategories]
  );

  // Destaca o atalho da seção que está na faixa de leitura da tela.
  useEffect(() => {
    const elements = sectionIds.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActiveId(entry.target.id);
      },
      { rootMargin: "-25% 0px -65% 0px" }
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sectionIds]);

  const chipClass = (id: string) =>
    `shrink-0 whitespace-nowrap rounded-xl px-4 py-2 text-label-lg transition-colors ${
      activeId === id ? "bg-primary text-white shadow-card" : "border border-border bg-surface-card text-graphite hover:bg-surface-subdued"
    }`;

  return (
    <>
      <div className="px-3.5 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar pratos, bebidas e combos..."
            aria-label="Buscar no cardápio"
            className="h-12 w-full rounded-2xl border border-border bg-surface-card pl-11 pr-4 text-body-md text-graphite shadow-card placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/20"
          />
        </div>
      </div>

      {sectionIds.length > 0 && (
        <nav
          aria-label="Categorias do cardápio"
          className="sticky top-0 z-30 mt-3 flex items-center gap-2 overflow-x-auto border-y border-border bg-surface-card/95 px-3.5 py-2.5 backdrop-blur-md [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {visibleCombos.length > 0 && (
            <a href="#combos" className={chipClass("combos")}>
              Combos
            </a>
          )}
          {visibleCategories.map((category) => (
            <a key={category.id} href={`#categoria-${category.id}`} className={chipClass(`categoria-${category.id}`)}>
              {category.name}
            </a>
          ))}
        </nav>
      )}

      {sectionIds.length === 0 && (
        <p className="px-6 py-16 text-center text-body-md text-text-muted">Nada encontrado para &ldquo;{query.trim()}&rdquo;.</p>
      )}

      {visibleCombos.length > 0 && (
        <section id="combos" className="scroll-mt-14 px-3.5 py-4">
          <h2 className="mb-3 text-headline-sm text-graphite">Combos</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {visibleCombos.map((combo) => (
              <StoreComboCard key={combo.id} combo={combo} />
            ))}
          </div>
        </section>
      )}

      {visibleCategories.map((category) => (
        <section key={category.id} id={`categoria-${category.id}`} className="scroll-mt-14 px-3.5 py-4">
          <h2 className="mb-3 text-headline-sm text-graphite">{category.name}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {category.products.map((product) => (
              <StoreProductCard
                key={product.id}
                href={`/loja/${slug}/produto/${product.id}`}
                name={product.name}
                description={product.description}
                price={product.price}
                imageUrl={product.imageUrl}
                isAvailable={product.is_available}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
