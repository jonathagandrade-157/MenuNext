"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyCashError, isMissingRpc, parseCashClosing, validateCashAmount, validateCashMovement, type CashClosing } from "@/lib/cash";

export type OpenCashResult = { status: "success" } | { status: "error"; message: string };
export type CloseCashResult = { status: "success"; closing: CashClosing } | { status: "error"; message: string };

/**
 * Abrir e fechar o caixa: o STAFF opera o caixa, então não exige OWNER. A loja nunca vem do cliente — as
 * RPCs cash_open/cash_close derivam a loja do usuário logado e recusam quem não é membro.
 */
async function authedClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/cadastro");
  return supabase;
}

export async function openCashAction(openingAmount: number | null): Promise<OpenCashResult> {
  const amount = validateCashAmount(openingAmount);
  if (!amount.ok) return { status: "error", message: amount.error };

  const supabase = await authedClient();
  const { error } = await supabase.rpc("cash_open", { p_opening_amount: amount.value });
  if (error) return { status: "error", message: friendlyCashError(error.message) };

  revalidatePath("/painel/caixa");
  return { status: "success" };
}

export async function closeCashAction(countedCash: number | null, notes: string): Promise<CloseCashResult> {
  const amount = validateCashAmount(countedCash);
  if (!amount.ok) return { status: "error", message: amount.error };

  const supabase = await authedClient();
  const { data, error } = await supabase.rpc("cash_close", { p_counted_cash: amount.value, p_notes: notes.trim() || null });
  if (error) return { status: "error", message: friendlyCashError(error.message) };

  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) return { status: "error", message: "Não foi possível concluir agora. Tente novamente." };

  revalidatePath("/painel/caixa");
  return { status: "success", closing: parseCashClosing(row) };
}

/**
 * Suprimento/sangria: STAFF e OWNER registram (a equipe opera o caixa); a RPC deriva a loja do usuário, exige caixa
 * aberto, trava a sessão e recusa sangria acima do dinheiro disponível. Cada linha guarda o autor.
 */
export async function recordCashMovementAction(kind: string, amount: number | null, reason: string): Promise<OpenCashResult> {
  const movement = validateCashMovement(kind, amount, reason);
  if (!movement.ok) return { status: "error", message: movement.error };

  const supabase = await authedClient();
  const { error } = await supabase.rpc("cash_record_movement", {
    p_kind: movement.value.kind,
    p_amount: movement.value.amount,
    p_reason: movement.value.reason,
  });
  if (isMissingRpc(error)) return { status: "error", message: "Movimentações de caixa ainda não estão disponíveis neste ambiente." };
  if (error) return { status: "error", message: friendlyCashError(error.message) };

  revalidatePath("/painel/caixa");
  return { status: "success" };
}
