"use server";

import { revalidatePath } from "next/cache";
import { requireOwnerAction } from "@/lib/tenant";
import { getPixAutoConfig, isPlausibleMercadoPagoToken, tokenHint } from "@/lib/pixAuto";
import { sealSecret } from "@/lib/secretBox";
import { isMissingRpc } from "@/lib/rpcErrors";

/**
 * Configuração do Pix automático (OWNER). O token chega pelo formulário, é cifrado AQUI (servidor) e só o texto
 * cifrado + 4 últimos caracteres vão para o banco. Nunca é devolvido, nem registrado em log.
 * As RPCs pix_settings_* exigem OWNER de novo no banco.
 */
export type PixSettingsActionResult = { ok: true } | { ok: false; error: string };

const PATH = "/painel/pagamentos";
const UNAVAILABLE = "O Pix automático ainda não está disponível neste ambiente.";

function friendly(message: string | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("not_authorized")) return "Apenas o proprietário pode alterar o Pix automático.";
  if (m.includes("not_configured")) return "Salve o token do Mercado Pago antes de ligar.";
  if (m.includes("invalid_token")) return "Token inválido.";
  return "Não foi possível salvar agora. Tente novamente.";
}

export async function savePixTokenAction(rawToken: string): Promise<PixSettingsActionResult> {
  const { supabase, restaurant } = await requireOwnerAction();
  const config = getPixAutoConfig();
  if (!config) return { ok: false, error: UNAVAILABLE };
  const token = typeof rawToken === "string" ? rawToken.trim() : "";
  if (!isPlausibleMercadoPagoToken(token)) {
    return { ok: false, error: "Cole o Access Token da sua conta Mercado Pago (começa com APP_USR- ou TEST-)." };
  }
  const { error } = await supabase.rpc("pix_settings_save", {
    p_restaurant: restaurant.id,
    p_ciphertext: sealSecret(token, restaurant.id, config.encryptionKey),
    p_hint: tokenHint(token),
  });
  if (isMissingRpc(error)) return { ok: false, error: UNAVAILABLE };
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath(PATH);
  return { ok: true };
}

export async function setPixAutoEnabledAction(enabled: boolean): Promise<PixSettingsActionResult> {
  const { supabase, restaurant } = await requireOwnerAction();
  if (!getPixAutoConfig()) return { ok: false, error: UNAVAILABLE };
  const { error } = await supabase.rpc("pix_settings_set_enabled", { p_restaurant: restaurant.id, p_enabled: enabled === true });
  if (isMissingRpc(error)) return { ok: false, error: UNAVAILABLE };
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deletePixTokenAction(): Promise<PixSettingsActionResult> {
  const { supabase, restaurant } = await requireOwnerAction();
  const { error } = await supabase.rpc("pix_settings_delete", { p_restaurant: restaurant.id });
  if (isMissingRpc(error)) return { ok: false, error: UNAVAILABLE };
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath(PATH);
  return { ok: true };
}
