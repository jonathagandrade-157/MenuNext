/**
 * Isolamento do painel Master (acesso a TODAS as lojas). Camadas, todas opcionais e configuradas por variável de
 * ambiente — sem nenhuma delas o comportamento é o de sempre (login + is_platform_admin):
 *
 *   MASTER_HOST         só atende /master neste domínio (ex.: master.seudominio.com.br). Em qualquer outro host
 *                       (a loja pública, o domínio *.vercel.app) o caminho responde 404, como se não existisse.
 *   MASTER_ALLOWED_IPS  lista (vírgula) de IPs ou faixas IPv4 CIDR (ex.: 203.0.113.7,198.51.100.0/24) autorizados.
 *   MASTER_REQUIRE_MFA  "true" exige segundo fator TOTP (nível AAL2 do Supabase) em toda página e ação do Master.
 *
 * FALHA FECHADO: variável definida mas sem nenhum valor válido (ex.: lista só com lixo) nega tudo; IP
 * desconhecido nunca passa quando há lista. Nada aqui concede acesso — só pode NEGAR; quem passa ainda precisa
 * ser administrador da plataforma (is_platform_admin, no banco).
 */
export type MasterEnv = Record<string, string | undefined>;
export type NetworkDecision = { allowed: true } | { allowed: false; reason: "host" | "ip" };

export const MASTER_MFA_PATH = "/master-mfa";

/** Caminhos atendidos pela política (o Master e a tela de segundo fator). */
export function isMasterPath(pathname: string): boolean {
  return pathname === "/master" || pathname.startsWith("/master/") || pathname === MASTER_MFA_PATH;
}

function normalizeHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "");
}

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** Entradas válidas: IPv4, IPv4/CIDR (0-32) ou IPv6 literal (comparação exata). O resto é descartado. */
export function parseIpList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => {
      if (!x) return false;
      const [addr, bits, extra] = x.split("/");
      if (extra !== undefined) return false;
      if (ipv4ToInt(addr) !== null) return bits === undefined || (/^\d{1,2}$/.test(bits) && Number(bits) <= 32);
      return bits === undefined && /^[0-9a-f:]+$/.test(addr) && addr.includes(":");
    });
}

export function ipInList(ip: string, list: string[]): boolean {
  const candidate = ip.trim().toLowerCase();
  if (!candidate || candidate === "unknown") return false;
  const asInt = ipv4ToInt(candidate);
  for (const entry of list) {
    const [addr, bits] = entry.split("/");
    if (bits === undefined) {
      if (addr === candidate) return true;
      continue;
    }
    const net = ipv4ToInt(addr);
    if (asInt === null || net === null) continue;
    const mask = Number(bits) === 0 ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0;
    if (((asInt & mask) >>> 0) === ((net & mask) >>> 0)) return true;
  }
  return false;
}

export function evaluateMasterNetwork(input: { host: string | null | undefined; ip: string }, env: MasterEnv = process.env): NetworkDecision {
  if (env.MASTER_HOST !== undefined && env.MASTER_HOST.trim() !== "") {
    if (normalizeHost(input.host) !== normalizeHost(env.MASTER_HOST)) return { allowed: false, reason: "host" };
  }
  if (env.MASTER_ALLOWED_IPS !== undefined && env.MASTER_ALLOWED_IPS.trim() !== "") {
    const list = parseIpList(env.MASTER_ALLOWED_IPS);
    if (list.length === 0 || !ipInList(input.ip, list)) return { allowed: false, reason: "ip" };
  }
  return { allowed: true };
}

export function masterMfaRequired(env: MasterEnv = process.env): boolean {
  return env.MASTER_REQUIRE_MFA?.trim().toLowerCase() === "true";
}

/** Cabeçalhos do Master: nunca em cache compartilhado e fora dos buscadores. */
export const MASTER_RESPONSE_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};
