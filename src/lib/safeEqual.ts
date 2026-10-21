import { createHash, timingSafeEqual } from "node:crypto";

/** Compara dois segredos em tempo constante (via digest SHA-256, que também
 * esconde o tamanho). Nunca use `===` para token ou segredo de cron. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}
