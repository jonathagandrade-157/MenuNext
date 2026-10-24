"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyCashError, parseCashClosing, validateCashAmount, type CashClosing } from "@/lib/cash";

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
