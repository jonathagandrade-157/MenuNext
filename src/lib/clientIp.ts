const MAX_IP_LENGTH = 64;

/** IP do cliente a partir dos cabeçalhos. Na Vercel o x-forwarded-for é definido pela própria plataforma
 * (o primeiro item é o cliente); IPv4/IPv6 só com os caracteres esperados, senão "unknown". */
export function pickClientIp(forwardedFor: string | null, realIp: string | null): string {
  const candidate = (forwardedFor?.split(",")[0] ?? realIp ?? "").trim();
  if (candidate.length === 0 || candidate.length > MAX_IP_LENGTH) return "unknown";
  return /^[0-9a-fA-F:.]+$/.test(candidate) ? candidate.toLowerCase() : "unknown";
}
