/**
 * Recuperação de senha — regras puras (o que as Server Actions e a rota de confirmação usam).
 *
 * Fluxo: pede o link (e-mail) → o Supabase envia o e-mail → o link cai em /auth/confirmar, que troca o código por
 * uma sessão e marca o navegador com o cookie abaixo → /redefinir-senha só aceita trocar a senha COM esse cookie.
 * Sem o cookie, quem já está logado (ou alguém com uma sessão roubada) não consegue trocar a senha sem a senha antiga.
 */

export const PASSWORD_RESET_COOKIE = "mn_pw_reset";
/** O link do e-mail vale pouco; a marca no navegador vale ainda menos (15 minutos). */
export const PASSWORD_RESET_COOKIE_MAX_AGE_SECONDS = 15 * 60;

const MAX_EMAIL_LENGTH = 254;

/** Checagem de forma, não de existência: o servidor nunca revela se o e-mail tem conta. */
export function isPlausibleEmail(value: string): boolean {
  if (value.length === 0 || value.length > MAX_EMAIL_LENGTH) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Mensagem para o usuário a partir do erro do Supabase ao TROCAR a senha. */
export function friendlyUpdatePasswordError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("different from the old password") || normalized.includes("same password")) {
    return "A nova senha precisa ser diferente da senha atual.";
  }
  if (normalized.includes("weak") || normalized.includes("password should be at least")) {
    return "A senha não foi aceita. Escolha uma senha mais forte, misturando letras e números.";
  }
  if (normalized.includes("session") || normalized.includes("not authenticated") || normalized.includes("jwt")) {
    return "Este link expirou. Peça um novo link de redefinição.";
  }
  return "Não foi possível alterar a senha. Tente novamente em instantes.";
}
