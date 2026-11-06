import type { EmailMessage } from "@/lib/email";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Só aceita link http(s) — o conteúdo do e-mail nunca leva outro esquema (javascript:, data:...). */
function safeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function buildInviteEmail(input: { to: string; restaurantName: string; inviteUrl: string }): EmailMessage | null {
  const url = safeUrl(input.inviteUrl);
  if (!url) return null;
  // nome da loja vem do lojista: sem quebras de linha no assunto e escapado no HTML
  const name = input.restaurantName.replace(/[\r\n]+/g, " ").trim().slice(0, 80) || "uma loja";
  const subject = `Convite para a equipe de ${name} no MenuNext`;
  const text = [
    `Você foi convidado(a) para fazer parte da equipe de ${name} no MenuNext.`,
    "",
    "Para aceitar, abra o link abaixo (ele expira em 7 dias):",
    url,
    "",
    "Se você não esperava este convite, ignore esta mensagem: nada acontece sem o seu aceite.",
  ].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">
<p>Você foi convidado(a) para fazer parte da equipe de <strong>${escapeHtml(name)}</strong> no MenuNext.</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#ab2f00;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none">Aceitar convite</a></p>
<p style="font-size:13px;color:#555">O link expira em 7 dias. Se o botão não funcionar, copie e cole este endereço no navegador:<br>${escapeHtml(url)}</p>
<p style="font-size:13px;color:#555">Se você não esperava este convite, ignore esta mensagem: nada acontece sem o seu aceite.</p>
</div>`;
  return { to: input.to, subject, html, text };
}
