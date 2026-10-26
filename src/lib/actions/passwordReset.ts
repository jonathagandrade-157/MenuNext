"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { PasswordResetActionState } from "@/lib/form-state";
import { validatePassword } from "@/lib/password";
import {
  PASSWORD_RESET_COOKIE,
  friendlyUpdatePasswordError,
  isPlausibleEmail,
} from "@/lib/passwordReset";
import { checkIpRateLimit, checkRateLimit, hashIdentifier, tooManyAttemptsMessage } from "@/lib/rateLimit";
import { getRequestOrigin } from "@/lib/site-url";
import { resolvePostAuthPath } from "@/lib/tenant";

const REQUEST_SENT: PasswordResetActionState = {
  status: "success",
  message: "Se existir uma conta com esse e-mail, enviamos um link para redefinir a senha. O link vale por pouco tempo.",
};

/**
 * Pede o e-mail de redefinição. A resposta é SEMPRE a mesma, exista a conta ou não (não dá para descobrir quem
 * é cliente), e há limite por IP e por e-mail: sem ele, esta tela serviria para encher a caixa de entrada de
 * qualquer pessoa.
 */
export async function requestPasswordResetAction(
  _prevState: PasswordResetActionState,
  formData: FormData
): Promise<PasswordResetActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!isPlausibleEmail(email)) return { status: "error", message: "Informe um e-mail válido." };

  const byIp = await checkIpRateLimit("recuperar:ip", { limit: 5, windowSeconds: 600 });
  if (!byIp.allowed) return { status: "error", message: tooManyAttemptsMessage(byIp.retryAfterSeconds) };
  const byEmail = await checkRateLimit("recuperar:conta", hashIdentifier(email), { limit: 3, windowSeconds: 600 });
  if (!byEmail.allowed) return { status: "error", message: tooManyAttemptsMessage(byEmail.retryAfterSeconds) };

  const supabase = await createClient();
  const origin = await getRequestOrigin();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/confirmar` });

  if (error) {
    // Limite de envio do próprio Supabase (1 e-mail por minuto por endereço): vale avisar, não revela nada sobre a conta.
    if (error.message.toLowerCase().includes("rate limit") || error.code === "over_email_send_rate_limit") {
      return { status: "error", message: "Já enviamos um link há pouco. Aguarde um minuto para pedir outro." };
    }
    // Qualquer outra falha (ex.: e-mail sem conta, envio indisponível) tem a mesma resposta; fica só no log do servidor.
    console.error("resetPasswordForEmail falhou:", error.code ?? error.message);
  }
  return REQUEST_SENT;
}

/**
 * Grava a nova senha. Só funciona com a sessão aberta pelo link do e-mail (cookie marcado por /auth/confirmar).
 * Depois de trocar, encerra as outras sessões da conta: quem tinha a senha antiga (ou uma sessão roubada) sai.
 */
export async function updatePasswordAction(
  _prevState: PasswordResetActionState,
  formData: FormData
): Promise<PasswordResetActionState> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const cookieStore = await cookies();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !cookieStore.get(PASSWORD_RESET_COOKIE)) {
    return { status: "error", message: "Este link expirou. Peça um novo link de redefinição." };
  }

  const byIp = await checkIpRateLimit("redefinir:ip", { limit: 10, windowSeconds: 600 });
  if (!byIp.allowed) return { status: "error", message: tooManyAttemptsMessage(byIp.retryAfterSeconds) };

  const check = validatePassword(password, { email: user.email ?? undefined });
  if (!check.ok) return { status: "error", message: check.error };
  if (password !== confirmPassword) return { status: "error", message: "As senhas não coincidem." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { status: "error", message: friendlyUpdatePasswordError(error.message) };

  await supabase.auth.signOut({ scope: "others" });
  cookieStore.delete(PASSWORD_RESET_COOKIE);
  redirect(await resolvePostAuthPath(supabase));
}
