"use server";

import { revalidatePath } from "next/cache";
import { requireMasterPage } from "@/lib/tenant";
import { friendlySupportError, isTicketId, validateMessageBody, type TicketPriority, type TicketStatus } from "@/lib/support";
import type { SupportActionResult } from "./supportMerchant";

const PATH = "/master/suporte";
const STATUSES: TicketStatus[] = ["open", "waiting_customer", "resolved", "closed"];
const PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];

/** Atendimento da plataforma: só admin (requireMasterPage); as RPCs conferem is_platform_admin de novo. */
export async function masterReplyTicketAction(ticketId: string, body: string): Promise<SupportActionResult> {
  const { supabase } = await requireMasterPage();
  if (!isTicketId(ticketId)) return { ok: false, error: "Chamado inválido." };
  const v = validateMessageBody(body);
  if (!v.ok) return { ok: false, error: v.error };
  const { error } = await supabase.rpc("support_add_message", { p_ticket: ticketId, p_body: v.value });
  if (error) return { ok: false, error: friendlySupportError(error.message) };
  revalidatePath(PATH);
  return { ok: true };
}

export async function masterSetTicketStatusAction(ticketId: string, status: string): Promise<SupportActionResult> {
  const { supabase } = await requireMasterPage();
  if (!isTicketId(ticketId) || !STATUSES.includes(status as TicketStatus)) return { ok: false, error: "Dados inválidos." };
  const { error } = await supabase.rpc("support_set_status", { p_ticket: ticketId, p_status: status });
  if (error) return { ok: false, error: friendlySupportError(error.message) };
  revalidatePath(PATH);
  return { ok: true };
}

export async function masterSetTicketPriorityAction(ticketId: string, priority: string): Promise<SupportActionResult> {
  const { supabase } = await requireMasterPage();
  if (!isTicketId(ticketId) || !PRIORITIES.includes(priority as TicketPriority)) return { ok: false, error: "Dados inválidos." };
  const { error } = await supabase.rpc("support_set_priority", { p_ticket: ticketId, p_priority: priority });
  if (error) return { ok: false, error: friendlySupportError(error.message) };
  revalidatePath(PATH);
  return { ok: true };
}
