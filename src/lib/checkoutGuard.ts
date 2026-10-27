import { checkRateLimit, hashIdentifier, type RateLimitRule } from "@/lib/rateLimit";

/**
 * Limites do checkout público ALÉM do limite por IP (que já existe em cada ação). Nenhum depende só de dado que o
 * visitante controla: o limite por loja vale para qualquer origem, o por IP + loja segura quem vem de um lugar só,
 * e o por telefone segura repetição do mesmo contato (o telefone pode ser trocado, por isso não é o único). O
 * último nível fica no banco (gatilho guard_online_order_flood), que vale mesmo se o contador do app cair.
 */
export type LimitSpec = { scope: string; identifier: string; rule: RateLimitRule };

const WINDOW = 600;
const STORE_SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;

/** Só slugs com cara de slug viram baldes (evita o visitante inventar milhares de baldes). */
export function normalizeStoreSlug(slug: string): string | null {
  const value = slug.trim().toLowerCase();
  return STORE_SLUG.test(value) ? value : null;
}

export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function buildOrderLimits(input: { slug: string; ip: string; phone: string }): LimitSpec[] {
  const slug = normalizeStoreSlug(input.slug);
  if (!slug) return [];
  const specs: LimitSpec[] = [
    { scope: "pedido:loja-ip", identifier: `${slug}:${input.ip}`, rule: { limit: 8, windowSeconds: WINDOW } },
    { scope: "pedido:loja", identifier: slug, rule: { limit: 120, windowSeconds: WINDOW } },
  ];
  const digits = phoneDigits(input.phone);
  if (digits.length >= 10 && digits.length <= 13) {
    specs.push({
      scope: "pedido:fone",
      identifier: `${slug}:${hashIdentifier(digits.slice(-11))}`,
      rule: { limit: 5, windowSeconds: WINDOW },
    });
  }
  return specs;
}

export function buildCouponLimits(input: { slug: string }): LimitSpec[] {
  const slug = normalizeStoreSlug(input.slug);
  return slug ? [{ scope: "cupom:loja", identifier: slug, rule: { limit: 120, windowSeconds: 60 } }] : [];
}

export type EnforceResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** Confere todos os limites em paralelo; basta um estourar para negar (devolve o maior tempo de espera). */
export async function enforceLimits(specs: LimitSpec[]): Promise<EnforceResult> {
  const results = await Promise.all(specs.map((s) => checkRateLimit(s.scope, s.identifier, s.rule)));
  const denied = results.filter((r) => !r.allowed);
  if (denied.length === 0) return { allowed: true };
  return { allowed: false, retryAfterSeconds: Math.max(...denied.map((r) => r.retryAfterSeconds)) };
}
