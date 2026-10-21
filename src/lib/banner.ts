/**
 * Banner promocional da loja (restaurant_banners) e produtos em destaque.
 * Validação pura do texto: o banco também limita (CHECK de 140 caracteres),
 * mas a tela precisa dizer o motivo em português antes de chegar lá.
 */

export const BANNER_MESSAGE_MAX = 140;
/** Quantos produtos em destaque a loja mostra no topo. */
export const FEATURED_PRODUCTS_LIMIT = 8;

export type BannerValidation = { ok: true; message: string } | { ok: false; error: string };

export function validateBanner(rawMessage: string, enabled: boolean): BannerValidation {
  const message = rawMessage.replace(/\s+/g, " ").trim();
  if (message.length > BANNER_MESSAGE_MAX) {
    return { ok: false, error: `O texto do banner deve ter até ${BANNER_MESSAGE_MAX} caracteres.` };
  }
  if (enabled && message === "") {
    return { ok: false, error: "Escreva o texto do banner ou desligue-o." };
  }
  return { ok: true, message };
}

/** Produtos que aparecem em "Destaques": marcados, disponíveis, na ordem do cardápio, sem passar do limite. */
export function pickFeaturedProducts<T extends { is_featured: boolean; is_available: boolean }>(
  productsInMenuOrder: T[],
  limit: number = FEATURED_PRODUCTS_LIMIT
): T[] {
  return productsInMenuOrder.filter((p) => p.is_featured && p.is_available).slice(0, limit);
}
