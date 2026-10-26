"use server";

import { createClient } from "@/lib/supabase/server";
import { checkIpRateLimit } from "@/lib/rateLimit";

export type PromotionPreview = { name: string; discountAmount: number } | null;

/**
 * Prévia da promoção automática no checkout público — sem efeito colateral (preview_promotion só lê). Só
 * informa o cliente; create_order recalcula tudo e é quem decide o desconto de verdade. Qualquer falha vira
 * "sem promoção" (a prévia nunca bloqueia o pedido).
 */
export async function previewPromotionAction(slug: string, subtotal: number): Promise<PromotionPreview> {
  if (!Number.isFinite(subtotal) || subtotal < 0) return null;
  const limit = await checkIpRateLimit("previa-promocao:ip", { limit: 60, windowSeconds: 60 });
  if (!limit.allowed) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_promotion", { p_slug: slug, p_subtotal: subtotal });
  if (error) return null;
  const row = data?.[0];
  return row ? { name: String(row.name), discountAmount: Number(row.discount_amount) } : null;
}
