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
export type HumanCheck = { ok: true } | { ok: false; reason: "missing" | "invalid" | "unavailable" };

export const TURNSTILE_FIELD = "cf-turnstile-response";
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TOKEN_LENGTH = 2048;
const TIMEOUT_MS = 5000;

export function turnstileEnabled(env: TurnstileEnv = process.env): boolean {
  return Boolean(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() && env.TURNSTILE_SECRET_KEY?.trim());
}

export async function verifyHuman(
  token: unknown,
  ip: string | null,
  env: TurnstileEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<HumanCheck> {
  if (!turnstileEnabled(env)) return { ok: true };
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "missing" };
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY!.trim(), response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    const response = await fetchImpl(VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return { ok: false, reason: "unavailable" };
    const data = (await response.json()) as { success?: boolean };
    return data.success === true ? { ok: true } : { ok: false, reason: "invalid" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export function humanCheckMessage(reason: "missing" | "invalid" | "unavailable"): string {
  if (reason === "unavailable") return "Não foi possível confirmar que você não é um robô agora. Tente novamente em instantes.";
  return "Confirme que você não é um robô e tente novamente.";
}
