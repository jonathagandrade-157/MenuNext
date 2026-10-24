"use server";

import { revalidatePath } from "next/cache";
import { requireOwnerAction } from "@/lib/tenant";
import { friendlyPromotionError, readPromotionForm } from "@/lib/promotions";
import type { PromotionActionState } from "@/lib/form-state";

const MARKETING_PATH = "/painel/marketing";

export async function createPromotionAction(_prev: PromotionActionState, formData: FormData): Promise<PromotionActionState> {
  const { supabase, restaurant } = await requireOwnerAction();

  const result = readPromotionForm(formData);
  if (!result.ok) return { status: "error", message: result.error };

  const { error } = await supabase.from("promotions").insert({ ...result.data, restaurant_id: restaurant.id });
  if (error) return { status: "error", message: friendlyPromotionError(error.message) };

  revalidatePath(MARKETING_PATH);
  return { status: "success" };
}

export async function updatePromotionAction(_prev: PromotionActionState, formData: FormData): Promise<PromotionActionState> {
  const { supabase } = await requireOwnerAction();

  const promotionId = String(formData.get("promotionId") ?? "");
  if (!promotionId) return { status: "error", message: "Promoção inválida." };

  const result = readPromotionForm(formData);
  if (!result.ok) return { status: "error", message: result.error };

  const { data: updated, error } = await supabase.from("promotions").update(result.data).eq("id", promotionId).select("id");
  if (error) return { status: "error", message: friendlyPromotionError(error.message) };
  if (!updated || updated.length === 0) return { status: "error", message: "Promoção não encontrada." };

  revalidatePath(MARKETING_PATH);
  return { status: "success" };
}

export async function togglePromotionActiveAction(promotionId: string, nextActive: boolean): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireOwnerAction();

  const { data, error } = await supabase.from("promotions").update({ is_active: nextActive }).eq("id", promotionId).select("id");
  if (error) return { ok: false, error: "Não foi possível atualizar. Tente novamente." };
  if (!data || data.length === 0) return { ok: false, error: "Promoção não encontrada." };

  revalidatePath(MARKETING_PATH);
  return { ok: true };
}

export async function deletePromotionAction(promotionId: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireOwnerAction();

  const { data, error } = await supabase.from("promotions").delete().eq("id", promotionId).select("id");
  if (error) return { ok: false, error: "Não foi possível excluir. Tente novamente." };
  if (!data || data.length === 0) return { ok: false, error: "Promoção não encontrada." };

  revalidatePath(MARKETING_PATH);
  return { ok: true };
}
