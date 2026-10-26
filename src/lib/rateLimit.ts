import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

/**
 * Limite de tentativas por IP / conta (login, cadastro, pedidos da loja pública, cupons, cálculo de frete).
 * O contador vive no banco (rate_limit_hit, só service_role) porque funções serverless não compartilham
 * memória. Falha ABERTO: se o contador estiver fora do ar, a loja continua funcionando — é uma camada extra
 * contra abuso, não a única defesa (create_order e o Supabase Auth seguem validando tudo).
 */

export type RateLimitRule = { limit: number; windowSeconds: number };
export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

const MAX_IP_LENGTH = 64;

/** IP do cliente a partir dos cabeçalhos. Na Vercel o x-forwarded-for é definido pela própria plataforma
 * (o primeiro item é o cliente); IPv4/IPv6 só com os caracteres esperados, senão "unknown". */
export function pickClientIp(forwardedFor: string | null, realIp: string | null): string {
  const candidate = (forwardedFor?.split(",")[0] ?? realIp ?? "").trim();
  if (candidate.length === 0 || candidate.length > MAX_IP_LENGTH) return "unknown";
  return /^[0-9a-fA-F:.]+$/.test(candidate) ? candidate.toLowerCase() : "unknown";
}

export async function getClientIp(): Promise<string> {
  const h = await headers();
  return pickClientIp(h.get("x-forwarded-for"), h.get("x-real-ip"));
}

/** Identificador estável e anônimo de um texto (ex.: e-mail), para não guardar dado pessoal no contador. */
export function hashIdentifier(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 32);
}

export async function checkRateLimit(scope: string, identifier: string, rule: RateLimitRule): Promise<RateLimitResult> {
  if (!isAdminConfigured()) return { allowed: true, retryAfterSeconds: 0 };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("rate_limit_hit", {
      p_bucket: `${scope}:${identifier}`.slice(0, 200),
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });
    if (error) {
      console.error("rate_limit_hit falhou (liberando):", error.message);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const row = (data as { is_allowed: boolean; retry_after: number }[] | null)?.[0];
    if (!row) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: row.is_allowed, retryAfterSeconds: row.retry_after };
  } catch (e) {
    console.error("rate_limit_hit indisponível (liberando):", e instanceof Error ? e.message : e);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/** Atalho: limita pelo IP de quem chamou. */
export async function checkIpRateLimit(scope: string, rule: RateLimitRule): Promise<RateLimitResult> {
  return checkRateLimit(scope, await getClientIp(), rule);
}

/** Mensagem para o usuário, em minutos arredondados para cima ("1 minuto", "5 minutos"). */
export function tooManyAttemptsMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Muitas tentativas seguidas. Aguarde ${minutes} ${minutes === 1 ? "minuto" : "minutos"} e tente novamente.`;
}
