"use server";

import { revalidatePath } from "next/cache";
import { requireOwnerAction } from "@/lib/tenant";
import { friendlyStockError, isUuid, parseStockInteger, validateStockMovement } from "@/lib/stock";

export type StockActionResult = { ok: true } | { ok: false; error: string };

const STOCK_PATH = "/painel/estoque";

/**
 * Estoque é administração da loja: só o OWNER movimenta (STAFF só lê o alerta). A loja nunca vem do formulário — o
 * produto é conferido pela RPC contra o OWNER da loja dele, e o banco recusa de qualquer forma (ver
 * supabase/tests/stock_ledger.sql).
 */
export async function recordStockMovementAction(
  productId: string,
  kind: string,
  rawQuantity: string,
  rawNote: string,
): Promise<StockActionResult> {
  const { supabase } = await requireOwnerAction();
  if (!isUuid(productId)) return { ok: false, error: "Produto inválido." };
  const movement = validateStockMovement(kind, rawQuantity, rawNote);
  if (!movement.ok) return { ok: false, error: movement.error };

  const { error } = await supabase.rpc("stock_record_movement", {
    p_product_id: productId,
    p_kind: movement.value.kind,
    p_quantity: movement.value.quantity,
    p_note: movement.value.note,
  });
  if (error) return { ok: false, error: friendlyStockError(error.message) };

  revalidatePath(STOCK_PATH);
  return { ok: true };
}

export async function setStockThresholdAction(productId: string, rawThreshold: string): Promise<StockActionResult> {
  const { supabase } = await requireOwnerAction();
  if (!isUuid(productId)) return { ok: false, error: "Produto inválido." };
  const threshold = parseStockInteger(rawThreshold, true);
  if (!threshold.ok) return { ok: false, error: threshold.error };

  const { error } = await supabase.rpc("stock_set_threshold", { p_product_id: productId, p_threshold: threshold.value });
  if (error) return { ok: false, error: friendlyStockError(error.message) };

  revalidatePath(STOCK_PATH);
  return { ok: true };
}
