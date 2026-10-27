"use server";

import { checkIpRateLimit } from "@/lib/rateLimit";
import { callPublicRpc } from "@/lib/publicRpc";

export type PromotionPreview = { name: string; discountAmount: number } | null;

/**
 * Prévia da promoção automática no checkout público — sem efeito colateral (preview_promotion só lê). Só
 * informa o cliente; create_order recalcula tudo e é quem decide o desconto de verdade. Qualquer falha vira
 * "sem promoção" (a prévia nunca bloqueia o pedido).
 */
export async function previewPromotionAction(slug: string, subtotal: number): Promise<PromotionPreview> {
  if (typeof slug !== "string" || slug.length === 0 || slug.length > 80) return null;
  if (!Number.isFinite(subtotal) || subtotal < 0) return null;
  const limit = await checkIpRateLimit("previa-promocao:ip", { limit: 60, windowSeconds: 60 });
  if (!limit.allowed) return null;
  const { data, error } = await callPublicRpc<{ name: string; discount_amount: string | number }[]>("preview_promotion", {
    p_slug: slug,
    p_subtotal: subtotal,
  });
  if (error) return null;
  const row = data?.[0];
  return row ? { name: String(row.name), discountAmount: Number(row.discount_amount) } : null;
}
