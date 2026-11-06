import { getClientIp } from "@/lib/rateLimit";
import { humanCheckMessage, TURNSTILE_FIELD, turnstileEnabled, verifyHuman } from "@/lib/turnstile";

/** Para Server Actions com FormData: devolve a mensagem de erro (ou null se passou / se a verificação está desligada). */
export async function humanCheckError(formData: FormData): Promise<string | null> {
  if (!turnstileEnabled()) return null;
  const result = await verifyHuman(formData.get(TURNSTILE_FIELD), await getClientIp());
  return result.ok ? null : humanCheckMessage(result.reason);
}
