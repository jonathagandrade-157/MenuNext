/**
 * Destino ("next") aceito depois do login. Nunca confia no texto vindo da URL ou do formulário:
 * só passa caminho interno, sem esquema/domínio, sem "//" ou "\" (que o navegador trata como outro
 * site) e sem caracteres de controle. Evita open redirect.
 *
 *  - convite:  /convite/<token>
 *  - painel:   /painel, /onboarding e /master (com subcaminhos, query e hash) — só no LOGIN; no cadastro
 *              novo o destino é sempre o onboarding.
 */
const MAX_LENGTH = 300;
const INVITE_RE = /^\/convite\/[^/?#]+$/;
const PANEL_RE = /^\/(?:painel|onboarding|master)(?:[/?#]|$)/;

function isCleanInternalPath(raw: string): boolean {
  if (raw.length === 0 || raw.length > MAX_LENGTH) return false;
  if (!raw.startsWith("/") || raw.startsWith("//")) return false;
  // barra invertida e caracteres de controle (inclui quebra de linha e NUL)
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return false;
  return true;
}

export function safeNextPath(raw: unknown, options: { allowPanel: boolean }): string | null {
  if (typeof raw !== "string" || !isCleanInternalPath(raw)) return null;
  if (INVITE_RE.test(raw)) return raw;
  if (options.allowPanel && PANEL_RE.test(raw)) return raw;
  return null;
}
