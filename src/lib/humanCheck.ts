import { headers } from "next/headers";
import { getClientIp } from "@/lib/rateLimit";
import { humanCheckMessage, TURNSTILE_FIELD, turnstileEnabled, turnstilePartiallyConfigured, verifyHuman } from "@/lib/turnstile";

let warnedPartial = false;

/**
 * Domínios em que o widget pode ter sido resolvido: o Host da requisição (o widget roda na própria página) ou, se
 * definida, a lista TURNSTILE_ALLOWED_HOSTNAMES (vírgula) — útil atrás de proxy que reescreve o Host.
 */
async function allowedHostnames(): Promise<string[]> {
  const configured = (process.env.TURNSTILE_ALLOWED_HOSTNAMES ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (configured.length > 0) return configured;
  const host = (await headers()).get("host");
  return host ? [host] : [];
}

/**
 * Núcleo: confere um token já extraído. `action` precisa ser o mesmo valor passado ao <TurnstileWidget action=...>.
 * Devolve a mensagem de erro (ou null se passou / se a verificação está desligada).
 */
export async function humanTokenError(token: unknown, action: string): Promise<string | null> {
  if (!turnstileEnabled()) {
    if (turnstilePartiallyConfigured() && !warnedPartial) {
      warnedPartial = true;
      console.warn("[turnstile] configuração incompleta: defina NEXT_PUBLIC_TURNSTILE_SITE_KEY e TURNSTILE_SECRET_KEY juntas; a verificação está DESLIGADA.");
    }
    return null;
  }
  const result = await verifyHuman(token, await getClientIp(), process.env, fetch, { action, hostnames: await allowedHostnames() });
  return result.ok ? null : humanCheckMessage(result.reason);
}

/** Para Server Actions chamadas por <form action> (o widget grava o token no campo `cf-turnstile-response`). */
export async function humanCheckError(formData: FormData, action: string): Promise<string | null> {
  return humanTokenError(formData.get(TURNSTILE_FIELD), action);
}
