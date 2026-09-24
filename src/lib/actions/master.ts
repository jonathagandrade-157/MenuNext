"use server";

import { revalidatePath } from "next/cache";
import { requireMasterPage } from "@/lib/tenant";
import type { PlatformSettingsActionState } from "@/lib/form-state";

export type { PlatformSettingsActionState };

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
