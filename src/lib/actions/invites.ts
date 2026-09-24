"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMyRestaurant, getMyMembership, type RestaurantInvite } from "@/lib/tenant";
import { getRequestOrigin } from "@/lib/site-url";
import type { InviteActionState } from "@/lib/form-state";

export type { InviteActionState };

const USUARIOS_PATH = "/painel/usuarios";

async function requireOwner(): Promise<{ supabase: SupabaseClient }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const membership = await getMyMembership(supabase, restaurant.id);
  if (membership?.role !== "OWNER") redirect(USUARIOS_PATH);

  return { supabase };
}

function friendlyInviteError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("already_member")) return "Esta pessoa já faz parte da sua equipe.";
  if (normalized.includes("invite_already_pending")) {
    return "Já existe um convite pendente para este e-mail. Revogue-o antes de enviar um novo.";
  }
  if (normalized.includes("invite_not_pending")) return "Este convite já foi usado, revogado ou reenviado.";
  if (normalized.includes("invalid_email")) return "Informe um e-mail válido.";
  if (normalized.includes("not_authorized")) return "Você não tem permissão para gerenciar a equipe.";
  if (normalized.includes("invite_not_found")) return "Convite não encontrado.";
  return "Não foi possível concluir. Tente novamente.";
}

export async function buildInviteUrl(token: string): Promise<string> {
  const origin = await getRequestOrigin();
  return `${origin.replace(/\/+$/, "")}/convite/${token}`;
}

// ---------------------------------------------------------------------------
// Criar convite — via RPC create_restaurant_invite (deriva o restaurante do
// próprio OWNER logado, checado de novo dentro da RPC). Nenhum e-mail é
// enviado (Resend sem domínio verificado ainda) — o link volta no estado de
// sucesso para o dono copiar.
// ---------------------------------------------------------------------------
export async function createInviteAction(
  _prev: InviteActionState,
  formData: FormData
): Promise<InviteActionState> {
  const { supabase } = await requireOwner();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { status: "error", message: "Informe um e-mail válido." };
  }

  const { data: invite, error } = await supabase.rpc("create_restaurant_invite", { p_email: email });

  if (error) return { status: "error", message: friendlyInviteError(error.message) };

  const inviteUrl = await buildInviteUrl((invite as RestaurantInvite).token);

  revalidatePath(USUARIOS_PATH);
  return { status: "success", inviteUrl };
}

// ---------------------------------------------------------------------------
// Revogar convite pendente — clique isolado, não formulário.
// ---------------------------------------------------------------------------
export async function revokeInviteAction(inviteId: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireOwner();

  const { error } = await supabase.rpc("revoke_restaurant_invite", { p_invite_id: inviteId });
  if (error) return { ok: false, error: friendlyInviteError(error.message) };

  revalidatePath(USUARIOS_PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reenviar convite — regenera token+expiração na MESMA linha (nunca cria
// uma segunda). Útil tanto para "esqueci de copiar o link" quanto para um
// convite que passou dos 7 dias sem ser aceito.
// ---------------------------------------------------------------------------
export async function resendInviteAction(inviteId: string): Promise<{ ok: boolean; error?: string; inviteUrl?: string }> {
  const { supabase } = await requireOwner();

  const { data: invite, error } = await supabase.rpc("resend_restaurant_invite", { p_invite_id: inviteId });
  if (error) return { ok: false, error: friendlyInviteError(error.message) };

  const inviteUrl = await buildInviteUrl((invite as RestaurantInvite).token);

  revalidatePath(USUARIOS_PATH);
  return { ok: true, inviteUrl };
}

function friendlyAcceptError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("email_mismatch")) {
    return "Este convite foi enviado para outro e-mail. Entre com a conta correta ou peça um novo convite.";
  }
  if (normalized.includes("already_has_restaurant")) {
    return "Sua conta já está associada a um restaurante — não é possível aceitar outro convite.";
  }
  if (normalized.includes("invite_expired")) return "Este convite expirou. Peça ao dono da loja para reenviar.";
  if (normalized.includes("invite_already_used")) return "Este convite já foi aceito.";
  if (normalized.includes("invite_revoked")) return "Este convite foi revogado.";
  if (normalized.includes("invite_not_found")) return "Convite não encontrado.";
  return "Não foi possível aceitar o convite. Tente novamente.";
}

// ---------------------------------------------------------------------------
// Aceitar convite — chamada pela tela pública /convite/[token] quando o
// usuário já está autenticado (signUp()/login padrão acontece antes, ver
// safeInviteRedirect em lib/actions/auth.ts). Redireciona para /painel em
// caso de sucesso (mesmo destino de quem já é dono de restaurante).
// ---------------------------------------------------------------------------
export async function acceptInviteAction(token: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/cadastro?next=${encodeURIComponent(`/convite/${token}`)}`);

  const { error } = await supabase.rpc("accept_restaurant_invite", { p_token: token });
  if (error) return { ok: false, error: friendlyAcceptError(error.message) };

  return { ok: true };
}
