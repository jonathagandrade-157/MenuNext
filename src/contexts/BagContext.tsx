"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { BagItem } from "@/lib/bag";

type BagContextValue = {
  items: BagItem[];
  addItem: (item: BagItem) => void;
  removeItem: (key: string) => void;
  updateItemQuantity: (key: string, quantity: number) => void;
  clearBag: () => void;
  totalItemCount: number;
  totalPrice: number;
};

const BagContext = createContext<BagContextValue | null>(null);

function storageKey(slug: string): string {
  return `menunext-bag-${slug}`;
}

/**
 * Sacola client-side/local (sem tabela no banco, Fase 3.2). Escopada por
 * slug — cada loja tem sua própria sacola, sem misturar restaurantes.
 * Persistida em localStorage só para sobreviver a uma navegação/refresh;
 * nunca é a fonte de verdade de preço (isso é recalculado no servidor
 * quando o pedido de fato existir, numa fase futura).
 */
export function BagProvider({ slug, children }: { slug: string; children: React.ReactNode }) {
  const [items, setItems] = useState<BagItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Hidratação única a partir do localStorage (só existe no client) — não
    // dá pra fazer isso num useState(() => ...) porque o SSR não tem acesso
    // a window, e o valor inicial teria que ser idêntico entre servidor e
    // cliente para não gerar mismatch de hidratação do React.
    try {
      const raw = window.localStorage.getItem(storageKey(slug));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setItems(JSON.parse(raw) as BagItem[]);
    } catch {
      // localStorage indisponível (modo privado, etc.) — sacola só fica em memória.
    }
    setHydrated(true);
  }, [slug]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(storageKey(slug), JSON.stringify(items));
    } catch {
      // idem — falha silenciosa, a sacola continua funcionando em memória.
    }
  }, [slug, items, hydrated]);

  const addItem = useCallback((item: BagItem) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.key === item.key);
      if (!existing) return [...prev, item];
      // Mesma combinação de produto+adicionais+observação -> soma quantidade
      // em vez de duplicar linha (itens com config diferente já têm key
      // diferente, então nunca caem aqui).
      return prev.map((i) =>
        i.key === item.key
          ? { ...i, quantity: i.quantity + item.quantity, subtotal: i.subtotal + item.subtotal }
          : i
      );
    });
  }, []);

  const removeItem = useCallback((key: string) => {
    setItems((prev) => prev.filter((i) => i.key !== key));
  }, []);

  // Só esvazia a sacola DESTA loja (o provider já é uma instância por slug,
  // com sua própria chave de localStorage) — nunca afeta a sacola de outro
  // restaurante. Chamada só depois de um pedido criado com sucesso.
  const clearBag = useCallback(() => {
    setItems([]);
  }, []);

  const updateItemQuantity = useCallback((key: string, quantity: number) => {
    setItems((prev) =>
      prev.map((i) =>
        i.key === key
          ? { ...i, quantity, subtotal: (i.subtotal / i.quantity) * quantity }
          : i
      )
    );
  }, []);

  const totalItemCount = useMemo(() => items.reduce((sum, i) => sum + i.quantity, 0), [items]);
  const totalPrice = useMemo(() => items.reduce((sum, i) => sum + i.subtotal, 0), [items]);

  const value = useMemo(
    () => ({ items, addItem, removeItem, updateItemQuantity, clearBag, totalItemCount, totalPrice }),
    [items, addItem, removeItem, updateItemQuantity, clearBag, totalItemCount, totalPrice]
  );

  return <BagContext.Provider value={value}>{children}</BagContext.Provider>;
}

export function useBag(): BagContextValue {
  const context = useContext(BagContext);
  if (!context) throw new Error("useBag deve ser usado dentro de um BagProvider.");
  return context;
}
