import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingRpc } from "./rpcErrors";

/**
 * Suporte: chamados do lojista (OWNER) e fila da plataforma. Escrita só pelas RPCs support_* (migration
 * 20261105020000_support_tickets); aqui ficam rótulos, validação e leitura. Sem a migration a tela mostra
 * "indisponível" em vez de falhar.
 */
export type TicketStatus = "open" | "waiting_customer" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Aberto", waiting_customer: "Aguardando você", resolved: "Resolvido", closed: "Encerrado",
};
export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = { low: "Baixa", normal: "Normal", high: "Alta", urgent: "Urgente" };
export const MERCHANT_PRIORITIES: TicketPriority[] = ["low", "normal", "high"];
export const SUBJECT_MIN = 3;
export const SUBJECT_MAX = 120;
export const BODY_MAX = 4000;

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateNewTicket(subject: unknown, body: unknown, priority: unknown): Validation<{ subject: string; body: string; priority: TicketPriority }> {
  const s = typeof subject === "string" ? subject.trim() : "";
  const b = typeof body === "string" ? body.trim() : "";
  if (s.length < SUBJECT_MIN) return { ok: false, error: `O assunto precisa ter ao menos ${SUBJECT_MIN} caracteres.` };
  if (s.length > SUBJECT_MAX) return { ok: false, error: `O assunto deve ter até ${SUBJECT_MAX} caracteres.` };
  const bodyCheck = validateMessageBody(b);
  if (!bodyCheck.ok) return bodyCheck;
  if (typeof priority !== "string" || !MERCHANT_PRIORITIES.includes(priority as TicketPriority)) return { ok: false, error: "Prioridade inválida." };
  return { ok: true, value: { subject: s, body: bodyCheck.value, priority: priority as TicketPriority } };
}

export function validateMessageBody(raw: unknown): Validation<string> {
  const b = typeof raw === "string" ? raw.trim() : "";
  if (!b) return { ok: false, error: "Escreva a mensagem." };
  if (b.length > BODY_MAX) return { ok: false, error: `A mensagem deve ter até ${BODY_MAX} caracteres.` };
  return { ok: true, value: b };
}

export const isTicketId = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export function friendlySupportError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("too_many_open")) return "Você já tem 10 chamados abertos. Encerre algum antes de abrir outro.";
  if (m.includes("rate_limited")) return "Muitas mensagens em pouco tempo. Aguarde um pouco e tente de novo.";
  if (m.includes("ticket_closed")) return "Este chamado está encerrado.";
  if (m.includes("invalid_subject")) return "Assunto inválido.";
  if (m.includes("invalid_body")) return "Mensagem inválida.";
  if (m.includes("invalid_priority")) return "Prioridade inválida.";
  if (m.includes("invalid_status")) return "Status inválido.";
  if (m.includes("not_authorized")) return "Você não tem permissão para esta ação.";
  return "Não foi possível concluir agora. Tente novamente.";
}

export type Ticket = {
  id: string; restaurantId: string; restaurantName: string | null; subject: string; priority: TicketPriority; status: TicketStatus;
  createdAt: string; lastMessageAt: string; messagesCount: number | null;
};
export type TicketMessage = { id: string; authorKind: "merchant" | "platform"; body: string; createdAt: string };

type Row = Record<string, unknown>;
const parseTicket = (r: Row): Ticket => ({
  id: String(r.id), restaurantId: String(r.restaurant_id), restaurantName: r.restaurant_name ? String(r.restaurant_name) : null,
  subject: String(r.subject), priority: r.priority as TicketPriority, status: r.status as TicketStatus,
  createdAt: String(r.created_at), lastMessageAt: String(r.last_message_at), messagesCount: r.messages_count == null ? null : Number(r.messages_count),
});
const parseMessage = (r: Row): TicketMessage => ({ id: String(r.id), authorKind: r.author_kind === "platform" ? "platform" : "merchant", body: String(r.body), createdAt: String(r.created_at) });

export type TicketsResult = { available: boolean; tickets: Ticket[] };

/** Chamados da loja do OWNER logado (RLS limita ao dono; o eq é defesa em profundidade). */
export async function getMerchantTickets(supabase: SupabaseClient, restaurantId: string): Promise<TicketsResult> {
  const { data, error } = await supabase
    .from("support_tickets")
    .select("id, restaurant_id, subject, priority, status, created_at, last_message_at")
    .eq("restaurant_id", restaurantId)
    .order("last_message_at", { ascending: false })
    .limit(100);
  if (isMissingRpc(error)) return { available: false, tickets: [] };
  if (error) throw error;
  return { available: true, tickets: ((data as Row[] | null) ?? []).map(parseTicket) };
}

/** Fila da plataforma (RPC só para admin). */
export async function getAdminTickets(supabase: SupabaseClient, status: TicketStatus | null): Promise<TicketsResult> {
  const { data, error } = await supabase.rpc("support_admin_list", { p_status: status, p_limit: 100 });
  if (isMissingRpc(error)) return { available: false, tickets: [] };
  if (error) throw error;
  return { available: true, tickets: ((data as Row[] | null) ?? []).map(parseTicket) };
}

export async function getTicketMessages(supabase: SupabaseClient, ticketId: string): Promise<TicketMessage[]> {
  const { data, error } = await supabase
    .from("support_messages")
    .select("id, author_kind, body, created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  return ((data as Row[] | null) ?? []).map(parseMessage);
}
