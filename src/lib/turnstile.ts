/**
 * Verificação anti-robô (Cloudflare Turnstile) nas ações públicas: cadastro, login e recuperação de senha.
 *
 * LIGADA só quando AS DUAS chaves existem: NEXT_PUBLIC_TURNSTILE_SITE_KEY (pública, desenha o widget) e
 * TURNSTILE_SECRET_KEY (servidor, nunca vai ao navegador). Sem as duas, nada muda. Ligada, a ação exige um token
 * válido, de uso único, confirmado na API da Cloudflare; ausência, token inválido ou falha da Cloudflare NEGAM
 * (falha fechado): o custo é a pessoa tentar de novo, o ganho é que robô sem token não passa.
 * Nunca registra token, IP nem segredo em log.
 */
export type TurnstileEnv = Record<string, string | undefined>;
export type HumanFailure = "missing" | "invalid" | "expired" | "hostname" | "action" | "unavailable";
export type HumanCheck = { ok: true } | { ok: false; reason: HumanFailure };
/** O que a página prometeu: a ação do widget e o(s) domínio(s) em que ele roda. Conferido contra a resposta da Cloudflare. */
export type HumanExpect = { action?: string; hostnames?: string[] };

export const TURNSTILE_FIELD = "cf-turnstile-response";
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TOKEN_LENGTH = 2048;
const TIMEOUT_MS = 5000;

export function turnstileEnabled(env: TurnstileEnv = process.env): boolean {
  return Boolean(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() && env.TURNSTILE_SECRET_KEY?.trim());
}

/** Exatamente UMA das chaves definida: nada é exigido nem desenhado (para não trancar ninguém), mas vale avisar o operador. */
export function turnstilePartiallyConfigured(env: TurnstileEnv = process.env): boolean {
  const site = Boolean(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim());
  const secret = Boolean(env.TURNSTILE_SECRET_KEY?.trim());
  return site !== secret;
}

/**
 * Segredos de TESTE oficiais da Cloudflare (1x/2x/3x + zeros + AA). Com eles a resposta traz `hostname: example.com` e
 * nenhuma `action`, então a conferência de contexto é pulada. Nunca são segredos reais, então isto não enfraquece produção.
 */
export function isTurnstileTestSecret(secret: string | undefined): boolean {
  return /^[123]x0{31}AA$/.test((secret ?? "").trim());
}

let warnedSecret = false;
const normHost = (h: string) => h.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");

export async function verifyHuman(
  token: unknown,
  ip: string | null,
  env: TurnstileEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  expect: HumanExpect = {},
): Promise<HumanCheck> {
  if (!turnstileEnabled(env)) return { ok: true };
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "missing" };
  try {
    const secret = env.TURNSTILE_SECRET_KEY!.trim();
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    const response = await fetchImpl(VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const data = (await response.json().catch(() => null)) as { success?: boolean; hostname?: string; action?: string; "error-codes"?: string[] } | null;
    // Nossa chave secreta errada/revogada: problema de CONFIGURAÇÃO, não do visitante. Nega (falha fechado) e avisa o
    // operador, porque sem esse aviso ninguém entra e a causa fica invisível. Nunca registra a chave.
    if (data?.["error-codes"]?.includes("invalid-input-secret")) {
      if (!warnedSecret) {
        warnedSecret = true;
        console.error("[turnstile] a Cloudflare recusou TURNSTILE_SECRET_KEY (invalid-input-secret). A verificação nega tudo até a chave ser corrigida.");
      }
      return { ok: false, reason: "unavailable" };
    }
    if (!response.ok || !data) return { ok: false, reason: "unavailable" };
    if (data.success !== true) {
      // token vencido (300 s) ou já usado: a Cloudflare não distingue os dois
      return { ok: false, reason: data["error-codes"]?.includes("timeout-or-duplicate") ? "expired" : "invalid" };
    }
    if (isTurnstileTestSecret(secret)) return { ok: true };
    // Um token de OUTRO site ou de OUTRO formulário não vale aqui (reaproveitamento entre ações/domínios).
    if (expect.hostnames && expect.hostnames.length > 0) {
      const allowed = expect.hostnames.map(normHost);
      if (typeof data.hostname !== "string" || !allowed.includes(normHost(data.hostname))) return { ok: false, reason: "hostname" };
    }
    if (expect.action !== undefined && data.action !== expect.action) return { ok: false, reason: "action" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export function humanCheckMessage(reason: HumanFailure): string {
  if (reason === "unavailable") return "Não foi possível confirmar que você não é um robô agora. Tente novamente em instantes.";
  if (reason === "expired") return "A verificação expirou ou já foi usada. Confirme novamente e tente de novo.";
  return "Confirme que você não é um robô e tente novamente.";
}
