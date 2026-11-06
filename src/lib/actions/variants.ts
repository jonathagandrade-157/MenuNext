"use server";

import { revalidatePath } from "next/cache";
import { requireOwnerAction } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { friendlyVariantError, isVariantId, validateVariantInput } from "@/lib/variants";
import { isMissingRpc } from "@/lib/rpcErrors";

export type VariantActionResult = { ok: true } | { ok: false; error: string };
const PATH = "/painel/variantes";
const UNAVAILABLE = "Variantes ainda não estão disponíveis neste ambiente.";

/** Criar/editar/apagar variantes: só OWNER. Ligar/desligar a disponibilidade: também STAFF (ver toggleVariantAvailableAction). */
export async function createVariantAction(productId: string, name: string, price: number | null, available: boolean): Promise<VariantActionResult> {
  const { supabase } = await requireOwnerAction();
  if (!isVariantId(productId)) return { ok: false, error: "Produto inválido." };
  const v = validateVariantInput(name, price);
  if (!v.ok) return { ok: false, error: v.error };
  const { error } = await supabase.rpc("product_variant_create", { p_product: productId, p_name: v.value.name, p_price: v.value.price, p_available: available !== false });
  if (isMissingRpc(error)) return { ok: false, error: UNAVAILABLE };
  if (error) return { ok: false, error: friendlyVariantError(error.message) };
  revalidatePath(PATH);
  return { ok: true };
}

export async function updateVariantAction(variantId: string, name: string, price: number | null, available: boolean): Promise<VariantActionResult> {
  const { supabase } = await requireOwnerAction();
  if (!isVariantId(variantId)) return { ok: false, error: "Variante inválida." };
  const v = validateVariantInput(name, price);
  if (!v.ok) return { ok: false, error: v.error };
  const { error } = await supabase.rpc("product_variant_update", { p_variant: variantId, p_name: v.value.name, p_price: v.value.price, p_available: Boolean(available) });
  if (isMissingRpc(error)) return { ok: false, error: UNAVAILABLE };
  if (error) return { ok: false, error: friendlyVariantError(error.message) };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteVariantAction(variantId: string): Promise<VariantActionResult> {
  const { supabase } = await requireOwnerAction();
  if (!isVariantId(variantId)) return { ok: false, error: "Variante inválida." };
  const { error } = await supabase.rpc("product_variant_delete", { p_variant: variantId });
  if (isMissingRpc(error)) return { ok: false, error: UNAVAILABLE };
  if (error) return { ok: false, error: friendlyVariantError(error.message) };
  revalidatePath(PATH);
  return { ok: true };
}

/** Liberada ao STAFF (operação do dia a dia): só muda is_available; a RPC exige membro da loja da variante. */
export async function toggleVariantAvailableAction(variantId: string, available: boolean): Promise<VariantActionResult> {
  const supabase = await createClient();
  if (!isVariantId(variantId) || typeof available !== "boolean") return { ok: false, error: "Dados inválidos." };
  const { error } = await supabase.rpc("product_variant_set_available", { p_variant: variantId, p_available: available });
  if (isMissingRpc(error)) return { ok: false, error: UNAVAILABLE };
  if (error) return { ok: false, error: friendlyVariantError(error.message) };
  revalidatePath(PATH);
  return { ok: true };
}
