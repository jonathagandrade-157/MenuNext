/**
 * Envio de e-mail transacional pelo Resend (API HTTP, sem dependência nova). SÓ de servidor: a chave nunca vai ao
 * navegador (ver serverOnlyGuard.test.ts). Desligado por padrão: sem RESEND_API_KEY **e** EMAIL_FROM (um remetente de
 * domínio verificado no Resend) nada é enviado e quem chama cai no fluxo manual (copiar o link).
 *
 * Nunca registra destinatário, assunto, corpo nem chave em log.
 */
export type EmailMessage = { to: string; subject: string; html: string; text: string };
export type EmailResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "invalid_recipient" | "rejected" | "unavailable" };

type Env = Record<string, string | undefined>;

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 8000;
const EMAIL_RE = /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/;

export function isEmailConfigured(env: Env = process.env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim());
}

export async function sendEmail(message: EmailMessage, env: Env = process.env): Promise<EmailResult> {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!apiKey || !from) return { ok: false, reason: "not_configured" };
  // um único destinatário bem formado; sem quebras de linha (injeção de cabeçalho)
  if (!EMAIL_RE.test(message.to) || message.to.length > 254 || /[\r\n]/.test(message.subject)) {
    return { ok: false, reason: "invalid_recipient" };
  }
  try {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [message.to], subject: message.subject, html: message.html, text: message.text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) return { ok: true };
    return { ok: false, reason: response.status >= 400 && response.status < 500 && response.status !== 429 ? "rejected" : "unavailable" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
