/**
 * Isolamento do painel Master (acesso a TODAS as lojas). Camadas, todas opcionais e configuradas por variável de
 * ambiente — sem nenhuma delas o comportamento é o de sempre (login + is_platform_admin):
 *
 *   MASTER_HOST         só atende /master neste domínio (ex.: master.seudominio.com.br). Em qualquer outro host
 *                       (a loja pública, o domínio *.vercel.app) o caminho responde 404, como se não existisse.
 *   MASTER_ALLOWED_IPS  lista (vírgula) de IPs ou faixas CIDR, IPv4 e IPv6 (ex.: 203.0.113.7,198.51.100.0/24,2001:db8::/32).
 *   MASTER_PROXY_HOPS   quantos proxies/CDNs ficam à frente do app (padrão 1 = só a Vercel); ver pickMasterClientIp.
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
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

// ---------------------------------------------------------------------------
// Endereços IP (IPv4 e IPv6 de verdade, com faixas CIDR)
// ---------------------------------------------------------------------------
// BigInt(...) em vez de literais 0n: o alvo do tsconfig é anterior ao ES2020.
const B0 = BigInt(0);
const B1 = BigInt(1);
const B8 = BigInt(8);
const B16 = BigInt(16);
const B32 = BigInt(32);

type ParsedIp = { version: 4 | 6; value: bigint };

function parseIpv4(text: string): bigint | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!m) return null;
  let out = B0;
  for (let i = 1; i <= 4; i++) {
    if (m[i].length > 1 && m[i].startsWith("0")) return null; // sem zero à esquerda (ambíguo: octal)
    const n = Number(m[i]);
    if (n > 255) return null;
    out = (out << B8) | BigInt(n);
  }
  return out;
}

function parseIpv6(text: string): bigint | null {
  if (!/^[0-9a-f:.]+$/.test(text) || text.includes(":::")) return null;
  const doubles = text.split("::");
  if (doubles.length > 2) return null;
  const toGroups = (part: string, allowV4: boolean): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    const pieces = part.split(":");
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      if (piece.includes(".")) {
        if (!allowV4 || i !== pieces.length - 1) return null; // IPv4 embutido só no FIM do endereço
        const v4 = parseIpv4(piece);
        if (v4 === null) return null;
        out.push(Number(v4 >> B16), Number(v4 & BigInt(0xffff)));
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
        out.push(parseInt(piece, 16));
      }
    }
    return out;
  };
  const head = toGroups(doubles[0], doubles.length === 1);
  const tail = doubles.length === 2 ? toGroups(doubles[1], true) : [];
  if (!head || !tail) return null;
  let groups: number[];
  if (doubles.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null; // "::" precisa representar ao menos um grupo
    groups = [...head, ...Array<number>(missing).fill(0), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  return groups.reduce((acc, g) => (acc << B16) | BigInt(g), B0);
}

/** IPv4-mapeado (::ffff:a.b.c.d) vira IPv4: é como muitos servidores entregam o endereço de um cliente IPv4. */
export function parseIp(raw: string): ParsedIp | null {
  const text = raw.trim().toLowerCase();
  if (!text || text.length > 45) return null;
  const v4 = parseIpv4(text);
  if (v4 !== null) return { version: 4, value: v4 };
  const v6 = parseIpv6(text);
  if (v6 === null) return null;
  if (v6 >> B32 === BigInt(0xffff)) return { version: 4, value: v6 & BigInt(0xffffffff) };
  return { version: 6, value: v6 };
}

type Cidr = { version: 4 | 6; network: bigint; bits: number };

function parseCidrEntry(entry: string): Cidr | null {
  const parts = entry.trim().split("/");
  if (parts.length > 2) return null;
  const ip = parseIp(parts[0]);
  if (!ip) return null;
  const max = ip.version === 4 ? 32 : 128;
  let bits = max;
  if (parts.length === 2) {
    if (!/^\d{1,3}$/.test(parts[1])) return null;
    bits = Number(parts[1]);
    // "::ffff:a.b.c.d/N" é IPv4 mapeado: a máscara vale para os 128 bits, então desconta os 96 do prefixo
    if (ip.version === 4 && parts[0].includes(":")) bits -= 96;
    if (bits < 0 || bits > max) return null;
  }
  const mask = bits === 0 ? B0 : ((B1 << BigInt(bits)) - B1) << BigInt(max - bits);
  return { version: ip.version, network: ip.value & mask, bits };
}

/** Entradas válidas da lista (IP ou CIDR, v4 ou v6). O resto é descartado. Guarda a forma textual normalizada. */
export function parseIpList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x !== "" && parseCidrEntry(x) !== null);
}

export function ipInList(ip: string, list: string[]): boolean {
  const candidate = parseIp(ip);
  if (!candidate) return false; // "unknown", vazio e lixo nunca passam
  const max = candidate.version === 4 ? 32 : 128;
  for (const entry of list) {
    const cidr = parseCidrEntry(entry);
    if (!cidr || cidr.version !== candidate.version) continue;
    const mask = cidr.bits === 0 ? B0 : ((B1 << BigInt(cidr.bits)) - B1) << BigInt(max - cidr.bits);
    if ((candidate.value & mask) === cidr.network) return true;
  }
  return false;
}

/**
 * IP do cliente para a política do Master. NÃO usa a primeira entrada de X-Forwarded-For (o cliente consegue
 * escrever nela): usa a entrada contada a partir da DIREITA, que é a que o proxy de borda acrescentou
 * (`fromRight` = 1 numa implantação direta na Vercel; some 1 para cada CDN/proxy extra à frente, via
 * MASTER_PROXY_HOPS). Sem X-Forwarded-For o IP é desconhecido (X-Real-IP não é usado: o cliente também o escreve). Qualquer coisa que não seja um IP válido vira "unknown".
 */
export function pickMasterClientIp(forwardedFor: string | null, fromRight = 1): string {
  const chain = (forwardedFor ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (chain.length === 0) return "unknown"; // X-Real-IP também é escrito pelo cliente: não é usado como alternativa
  const candidate = chain[chain.length - Math.min(Math.max(fromRight, 1), chain.length)];
  return parseIp(candidate) ? candidate.toLowerCase() : "unknown";
}

export function masterProxyHops(env: MasterEnv = process.env): number {
  const n = Number(env.MASTER_PROXY_HOPS);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 1;
}

/**
 * Host do pedido: SOMENTE o cabeçalho Host (o que a plataforma usou para rotear). X-Forwarded-Host é ignorado
 * de propósito: é escrito pelo cliente e permitiria "ser" o domínio do Master.
 */
export function masterRequestHost(h: { get(name: string): string | null }): string | null {
  return h.get("host");
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
