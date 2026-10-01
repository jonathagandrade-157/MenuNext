"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMyRestaurant, type Restaurant } from "@/lib/tenant";
import type { CouponActionState } from "@/lib/form-state";

const MARKETING_PATH = "/painel/marketing";

async function requireRestaurant(): Promise<{ supabase: SupabaseClient; restaurant: Restaurant }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  return { supabase, restaurant };
}

/** null para vazio, NaN para "preenchido mas inválido" — mesmo padrão de
 * parseOptionalDecimal em actions/deliveryZones.ts. */
function parseOptionalDecimal(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : NaN;
}

function friendlyCouponError(message: string): string {
  if (message.toLowerCase().includes("duplicate key")) {
    return "Já existe um cupom com esse código.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

type CouponFormData = {
  code: string;
  discount_type: "percent" | "fixed";
  discount_value: number;
  min_order_value: number | null;
  max_uses: number | null;
  expires_at: string | null;
};

function readCouponForm(formData: FormData): { ok: true; data: CouponFormData } | { ok: false; error: string } {
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const discountType = String(formData.get("discount_type") ?? "");
  const discountValueRaw = String(formData.get("discount_value") ?? "");
  const minOrderRaw = String(formData.get("min_order_value") ?? "");
  const maxUsesRaw = String(formData.get("max_uses") ?? "").trim();
  const expiresAtRaw = String(formData.get("expires_at") ?? "").trim();

  if (code.length < 2 || code.length > 30) {
    return { ok: false, error: "Informe um código de 2 a 30 caracteres." };
  }
  if (!/^[A-Z0-9-]+$/.test(code)) {
    return { ok: false, error: "O código deve conter apenas letras, números e hífen." };
  }

  if (discountType !== "percent" && discountType !== "fixed") {
    return { ok: false, error: "Selecione o tipo de desconto." };
  }

  const discountValue = parseOptionalDecimal(discountValueRaw);
  if (discountValue === null || Number.isNaN(discountValue) || discountValue <= 0) {
    return { ok: false, error: "Informe um valor de desconto válido." };
  }
  if (discountType === "percent" && discountValue > 100) {
    return { ok: false, error: "O desconto percentual não pode passar de 100%." };
  }

  const minOrderValue = parseOptionalDecimal(minOrderRaw);
  if (Number.isNaN(minOrderValue) || (minOrderValue !== null && minOrderValue < 0)) {
    return { ok: false, error: "Informe um pedido mínimo válido." };
  }

  const maxUses = maxUsesRaw === "" ? null : Number(maxUsesRaw);
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses <= 0)) {
    return { ok: false, error: "Informe um limite de usos válido (número inteiro maior que zero)." };
  }

  const expiresAt = expiresAtRaw === "" ? null : new Date(`${expiresAtRaw}T23:59:59`).toISOString();
  if (expiresAtRaw !== "" && Number.isNaN(new Date(expiresAt as string).getTime())) {
    return { ok: false, error: "Informe uma data de validade válida." };
  }

  return {
    ok: true,
    data: { code, discount_type: discountType, discount_value: discountValue, min_order_value: minOrderValue, max_uses: maxUses, expires_at: expiresAt },
  };
}

export async function createCouponAction(_prev: CouponActionState, formData: FormData): Promise<CouponActionState> {
  const { supabase, restaurant } = await requireRestaurant();

  const result = readCouponForm(formData);
  if (!result.ok) return { status: "error", message: result.error };

  const { error } = await supabase.from("coupons").insert({ ...result.data, restaurant_id: restaurant.id });
  if (error) return { status: "error", message: friendlyCouponError(error.message) };

  revalidatePath(MARKETING_PATH);
  return { status: "success" };
}

export async function updateCouponAction(_prev: CouponActionState, formData: FormData): Promise<CouponActionState> {
  const { supabase } = await requireRestaurant();

  const couponId = String(formData.get("couponId") ?? "");
  if (!couponId) return { status: "error", message: "Cupom inválido." };

  const result = readCouponForm(formData);
  if (!result.ok) return { status: "error", message: result.error };

  const { data: updated, error } = await supabase.from("coupons").update(result.data).eq("id", couponId).select("id");
  if (error) return { status: "error", message: friendlyCouponError(error.message) };
  if (!updated || updated.length === 0) return { status: "error", message: "Cupom não encontrado." };

  revalidatePath(MARKETING_PATH);
  return { status: "success" };
}

export async function toggleCouponActiveAction(couponId: string, nextActive: boolean): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { data, error } = await supabase.from("coupons").update({ is_active: nextActive }).eq("id", couponId).select("id");
  if (error) return { ok: false, error: "Não foi possível atualizar. Tente novamente." };
  if (!data || data.length === 0) return { ok: false, error: "Cupom não encontrado." };

  revalidatePath(MARKETING_PATH);
  return { ok: true };
}

export async function deleteCouponAction(couponId: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { data, error } = await supabase.from("coupons").delete().eq("id", couponId).select("id");
  if (error) return { ok: false, error: "Não foi possível excluir. Tente novamente." };
  if (!data || data.length === 0) return { ok: false, error: "Cupom não encontrado." };

  revalidatePath(MARKETING_PATH);
  return { ok: true };
}
