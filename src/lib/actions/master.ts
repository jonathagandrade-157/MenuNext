"use server";

import { revalidatePath } from "next/cache";
import { requireMasterPage } from "@/lib/tenant";
import type { PlatformSettingsActionState, TrialExtensionActionState } from "@/lib/form-state";
import { parseExtensionDays } from "@/lib/trialExtension";

export type { PlatformSettingsActionState, TrialExtensionActionState };

const CONFIGURACOES_PATH = "/master/configuracoes";

function friendlyPlatformSettingsError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid_email")) return "Informe um e-mail válido (ou deixe em branco).";
  if (normalized.includes("not_authorized")) return "Você não tem permissão para alterar essas configurações.";
  return "Não foi possível salvar. Tente novamente.";
}

/** Contato de suporte exibido em /painel/ajuda (JON-9/master) — via RPC
 * update_platform_settings, restrita a is_platform_admin() no próprio banco. */
export async function updatePlatformSettingsAction(
  _prev: PlatformSettingsActionState,
  formData: FormData
): Promise<PlatformSettingsActionState> {
  const { supabase } = await requireMasterPage();

  const supportEmail = String(formData.get("supportEmail") ?? "").trim();
  const supportWhatsapp = String(formData.get("supportWhatsapp") ?? "").trim();

  const { error } = await supabase.rpc("update_platform_settings", {
    p_support_email: supportEmail || null,
    p_support_whatsapp: supportWhatsapp || null,
  });

  if (error) return { status: "error", message: friendlyPlatformSettingsError(error.message) };

  revalidatePath(CONFIGURACOES_PATH);
  revalidatePath("/painel/ajuda");
  return { status: "success" };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function friendlyTrialExtensionError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("not_authorized")) return "Você não tem permissão para prorrogar o teste.";
  if (normalized.includes("has_plan")) return "Esta loja já tem plano; a cortesia vale só para quem está sem plano.";
  if (normalized.includes("no_owner")) return "Esta loja não tem um responsável (OWNER) para receber o prazo.";
  if (normalized.includes("restaurant_not_found")) return "Restaurante não encontrado.";
  if (normalized.includes("invalid_days")) return "Escolha um prazo válido.";
  return "Não foi possível prorrogar o teste. Tente novamente.";
}

/** Cortesia de trial: o master prorroga o teste gratuito de uma loja sem plano.
 * A regra (e o registro de quem concedeu) vive na RPC master_extend_trial. */
export async function extendTrialAction(
  _prev: TrialExtensionActionState,
  formData: FormData
): Promise<TrialExtensionActionState> {
  const { supabase } = await requireMasterPage();

  const restaurantId = String(formData.get("restaurantId") ?? "");
  const days = parseExtensionDays(formData.get("days"));
  if (!UUID_PATTERN.test(restaurantId)) return { status: "error", message: "Restaurante inválido." };
  if (days === null) return { status: "error", message: "Escolha um prazo válido." };

  const { error } = await supabase.rpc("master_extend_trial", { p_restaurant_id: restaurantId, p_days: days });
  if (error) return { status: "error", message: friendlyTrialExtensionError(error.message) };

  revalidatePath(`/master/restaurantes/${restaurantId}`);
  revalidatePath("/master/restaurantes");
  return { status: "success" };
}

export type RequireAal2Result = { ok: true } | { ok: false; error: string };

function friendlyAal2Error(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("aal2_required")) return "Faça a verificação em duas etapas em /master-mfa nesta sessão antes de alterar esta opção.";
  if (m.includes("not_authorized")) return "Você não tem permissão para esta ação.";
  if (m.includes("could not find the function") || m.includes("pgrst202")) return "Esta opção ainda não está disponível neste ambiente (migration não aplicada).";
  return "Não foi possível concluir agora. Tente novamente.";
}

/**
 * Liga/desliga a exigência de segundo fator (AAL2) NO BANCO para o administrador da plataforma
 * (migration 20261107000000_platform_admin_require_aal2). A RPC só aceita quem está em AAL2 nesta sessão —
 * quem liga acabou de provar que o segundo fator funciona (anti-trancamento).
 */
export async function setRequireAal2Action(enabled: boolean): Promise<RequireAal2Result> {
  const { supabase } = await requireMasterPage();
  if (typeof enabled !== "boolean") return { ok: false, error: "Valor inválido." };
  const { error } = await supabase.rpc("platform_set_require_aal2", { p_enabled: enabled });
  if (error) return { ok: false, error: friendlyAal2Error(error.message) };
  revalidatePath("/master/configuracoes");
  return { ok: true };
}
