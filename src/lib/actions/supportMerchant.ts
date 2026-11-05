"use server";

import { revalidatePath } from "next/cache";
import { requireOwnerAction } from "@/lib/tenant";
import { friendlySupportError, isTicketId, validateMessageBody, validateNewTicket } from "@/lib/support";
import { isMissingRpc } from "@/lib/rpcErrors";

export type SupportActionResult = { ok: true; id?: string } | { ok: false; error: string };
const PATH = "/painel/suporte";
const UNAVAILABLE = "O suporte por chamados ainda não está disponível neste ambiente.";

/** Chamados do lojista: só OWNER; a loja vem da sessão e a RPC confere de novo. */
export async function createTicketAction(subject: string, body: string, priority: string): Promise<SupportActionResult> {
  const { supabase } = await requireOwnerAction();
  const v = validateNewTicket(subject, body, priority);
  if (!v.ok) return { ok: false, error: v.error };
  const { data, error } = await supabase.rpc("support_create_ticket", { p_subject: v.value.subject, p_body: v.value.body, p_priority: v.value.priority });
  if (isMissingRpc(error)) return { ok: false, error: UNAVAILABLE };
  if (error) return { ok: false, error: friendlySupportError(error.message) };
  revalidatePath(PATH);
  return { ok: true, id: String(data) };
}

export async function replyTicketAction(ticketId: string, body: string): Promise<SupportActionResult> {
  const { supabase } = await requireOwnerAction();
  if (!isTicketId(ticketId)) return { ok: false, error: "Chamado inválido." };
  const v = validateMessageBody(body);
  if (!v.ok) return { ok: false, error: v.error };
  const { error } = await supabase.rpc("support_add_message", { p_ticket: ticketId, p_body: v.value });
  if (isMissingRpc(error)) return { ok: false, error: UNAVAILABLE };
  if (error) return { ok: false, error: friendlySupportError(error.message) };
  revalidatePath(PATH);
  return { ok: true };
}

export async function closeTicketAction(ticketId: string): Promise<SupportActionResult> {
  const { supabase } = await requireOwnerAction();
  if (!isTicketId(ticketId)) return { ok: false, error: "Chamado inválido." };
  const { error } = await supabase.rpc("support_set_status", { p_ticket: ticketId, p_status: "closed" });
  if (isMissingRpc(error)) return { ok: false, error: UNAVAILABLE };
  if (error) return { ok: false, error: friendlySupportError(error.message) };
  revalidatePath(PATH);
  return { ok: true };
}
