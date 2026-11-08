"use server";

import { revalidatePath } from "next/cache";
import { requireOwnerAction } from "@/lib/tenant";
import { getMercadoPagoAccountId, getPixAutoConfig, isPlausibleMercadoPagoToken, isPlausibleWebhookSecret, tokenHint } from "@/lib/pixAuto";
import { tokenContext, webhookSecretContext } from "@/lib/pixAutoService";
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
  if (m.includes("invalid_secret")) return "Assinatura secreta inválida.";
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
  // confere o token NA API e descobre a conta recebedora (os pagamentos só são aceitos se caírem nela)
  const account = await getMercadoPagoAccountId(token);
  if (!account.ok) {
    return {
      ok: false,
      error: account.httpStatus === 401 || account.httpStatus === 403
        ? "O Mercado Pago recusou este token. Confira se copiou o Access Token de produção da sua aplicação."
        : "Não foi possível conferir o token no Mercado Pago agora. Tente novamente.",
    };
  }
  const { error } = await supabase.rpc("pix_settings_save", {
    p_restaurant: restaurant.id,
    p_ciphertext: sealSecret(token, tokenContext(restaurant.id), config.encryptionKey),
    p_hint: tokenHint(token),
    p_collector_id: account.collectorId,
  });
  if (isMissingRpc(error)) return { ok: false, error: UNAVAILABLE };
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath(PATH);
  return { ok: true };
}

/** Assinatura secreta de webhooks da aplicação da loja (opcional): com ela, avisos sem x-signature válido são recusados. Vazio = remove. */
export async function savePixWebhookSecretAction(rawSecret: string): Promise<PixSettingsActionResult> {
  const { supabase, restaurant } = await requireOwnerAction();
  const config = getPixAutoConfig();
  if (!config) return { ok: false, error: UNAVAILABLE };
  const secret = typeof rawSecret === "string" ? rawSecret.trim() : "";
  if (secret && !isPlausibleWebhookSecret(secret)) {
    return { ok: false, error: "Cole a assinatura secreta exibida em Webhooks na sua aplicação do Mercado Pago." };
  }
  const { error } = await supabase.rpc("pix_settings_save_webhook_secret", {
    p_restaurant: restaurant.id,
    p_ciphertext: secret ? sealSecret(secret, webhookSecretContext(restaurant.id), config.encryptionKey) : null,
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
