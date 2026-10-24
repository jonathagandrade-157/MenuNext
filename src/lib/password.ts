/**
 * Regras de senha no cadastro. O Supabase só exige 6 caracteres e a proteção contra senhas vazadas
 * é recurso de plano pago; aqui o app fecha o que dá: tamanho mínimo, senhas óbvias e senha que repete
 * o e-mail. Só vale para criar conta — quem já tem senha de 6 caracteres continua entrando normalmente.
 */

export const PASSWORD_MIN_LENGTH = 8;
/** O Supabase (bcrypt) ignora o que passa de 72 bytes: melhor recusar do que aceitar uma senha "cortada". */
export const PASSWORD_MAX_LENGTH = 72;

const COMMON_PASSWORDS = new Set([
  "12345678", "123456789", "1234567890", "123123123", "11111111", "00000000", "12341234", "87654321",
  "password", "password1", "password123", "senha123", "senha1234", "senha12345", "senhasenha",
  "qwertyui", "qwerty123", "qwertyuiop", "asdfghjk", "abcd1234", "abc12345", "abcdefgh",
  "admin123", "administrador", "iloveyou", "brasil123", "brasileiro", "mudar123", "trocar123",
  "menunext", "menunext1", "menunext123", "restaurante", "restaurante123", "lanchonete", "hamburguer",
]);

export type PasswordValidation = { ok: true } | { ok: false; error: string };

export function validatePassword(password: string, context: { email?: string; name?: string } = {}): PasswordValidation {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.` };
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_LENGTH) {
    return { ok: false, error: `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.` };
  }

  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower) || /^(.)\1+$/.test(password)) {
    return { ok: false, error: "Essa senha é muito comum. Escolha outra, misturando letras e números." };
  }
  if (/^\d+$/.test(password)) {
    return { ok: false, error: "Use também letras na senha, não só números." };
  }

  const emailName = (context.email ?? "").split("@")[0].toLowerCase();
  if (emailName.length >= 4 && lower.includes(emailName)) {
    return { ok: false, error: "A senha não pode conter o seu e-mail." };
  }
  const firstName = (context.name ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (firstName.length >= 4 && lower === firstName) {
    return { ok: false, error: "A senha não pode ser só o seu nome." };
  }

  return { ok: true };
}
