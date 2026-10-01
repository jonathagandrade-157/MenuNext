"use server";

import { createClient } from "@/lib/supabase/server";

export type ValidateCouponResult =
  | { status: "success"; code: string; discountType: "percent" | "fixed"; discountValue: number; discountAmount: number }
  | { status: "error"; message: string };

function friendlyCouponValidationError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("coupon_not_found")) return "Cupom não encontrado.";
  if (normalized.includes("coupon_inactive")) return "Este cupom não está mais ativo.";
  if (normalized.includes("coupon_expired")) return "Este cupom expirou.";
  if (normalized.includes("coupon_usage_limit_reached")) return "Este cupom atingiu o limite de usos.";
  if (normalized.includes("coupon_below_minimum_order")) return "Seu pedido ainda não atingiu o mínimo exigido por este cupom.";
  return "Não foi possível validar o cupom agora. Tente novamente.";
}

/**
 * Preview do cupom no checkout — sem efeito colateral (validate_coupon no
 * banco não incrementa uses_count, só create_order faz isso de verdade no
 * momento da redenção). Dá feedback imediato ("cupom aplicado: -R$X") antes
 * de finalizar o pedido; create_order revalida tudo de novo e é quem
 * decide de fato se o cupom é aplicado.
 */
export async function validateCouponAction(slug: string, code: string, subtotal: number): Promise<ValidateCouponResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("validate_coupon", { p_slug: slug, p_code: code, p_subtotal: subtotal });
  if (error) return { status: "error", message: friendlyCouponValidationError(error.message) };

  const row = data?.[0];
  if (!row) return { status: "error", message: "Cupom não encontrado." };

  return {
    status: "success",
    code: row.code,
    discountType: row.discount_type,
    discountValue: Number(row.discount_value),
    discountAmount: Number(row.discount_amount),
  };
}
