// Núcleo dos scripts de backup do MenuNext. Sem dependências externas: usa só Node, `gpg` e `tar`.
// Nenhuma credencial é lida aqui: cada comando recebe o que precisa por parâmetro (vindo do ambiente do executor).
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";

export const MANIFEST_SUFFIX = ".manifest.json";

/** "<prefixo>-20261027T031500Z" (UTC, ordenável como texto). */
export function backupStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Lê a data de um nome "<prefixo>-20261027T031500Z.<ext>"; devolve null se não bater. */
export function parseStamp(name) {
  const m = /-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z(?:\.|$)/.exec(name);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export function run(cmd, args, { env = {}, cwd, input } = {}) {
  const [bin, ...prefix] = Array.isArray(cmd) ? cmd : [cmd];
  return new Promise((resolve, reject) => {
    const child = execFile(
      bin,
      [...prefix, ...args],
      { env: { ...process.env, ...env }, cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          const e = new Error(`${path.basename(bin)} falhou (código ${error.code ?? "?"}): ${redact(String(stderr || error.message)).slice(0, 400)}`);
          e.code = error.code;
          reject(e);
        } else resolve({ stdout, stderr });
      }
    );
    if (input !== undefined) child.stdin.end(input);
  });
}

/** Tira senhas de URLs e tokens de qualquer texto que vá para log ou mensagem de erro. */
export function redact(text) {
  return String(text)
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+@/gi, "$1***@")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, "$1***")
    .replace(/(password|passwd|secret|token|apikey)=\S+/gi, "$1=***");
}

/** Converte a URL do banco em variáveis PG*; assim a senha nunca aparece na lista de processos. */
export function pgEnvFromUrl(urlText) {
  const url = new URL(urlText);
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error("DATABASE_URL precisa começar com postgres:// ou postgresql://");
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres",
    PGSSLMODE: url.searchParams.get("sslmode") ?? "require",
  };
}

/** Restauração só em banco DESCARTÁVEL: recusa qualquer destino que não seja a própria máquina. */
export function assertDisposableTarget(urlText) {
  let host;
  try {
    host = new URL(urlText).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    throw new Error("URL de restauração inválida");
  }
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
  if (!local) throw new Error("Recusado: a restauração de teste só roda em banco local/descartável (localhost).");
}

const gpgStyleCache = new Map();

/** No Windows, o gpg do Git (MSYS) só entende caminhos "/c/pasta"; o Gpg4win entende "C:\pasta". Detecta pelo "Home:". */
async function gpgWantsPosixPaths(gpgBin) {
  if (process.platform !== "win32") return false;
  if (!gpgStyleCache.has(gpgBin)) {
    const { stdout } = await run(gpgBin, ["--version"]).catch(() => ({ stdout: "" }));
    gpgStyleCache.set(gpgBin, /Home:\s*\//.test(stdout));
  }
  return gpgStyleCache.get(gpgBin);
}

export async function gpgPath(gpgBin, p) {
  if (!p || !(await gpgWantsPosixPaths(gpgBin))) return p;
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  return m ? `/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}` : p.replace(/\\/g, "/");
}

export function gpgArgs(homedir) {
  return ["--batch", "--yes", "--no-tty", ...(homedir ? ["--homedir", homedir] : [])];
}

/**
 * Criptografia com a chave PÚBLICA do dono: quem executa o backup não consegue ler o que gerou. `recipient` aceita VÁRIAS
 * chaves separadas por vírgula (ex.: a do dono e uma de emergência guardada por outra pessoa): qualquer uma decifra, então
 * perder uma chave não perde os backups.
 */
export async function encryptFile(src, dest, recipient, { gpgBin = "gpg", homedir } = {}) {
  const recipients = String(recipient ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  if (recipients.length === 0) throw new Error("Informe o destinatário da criptografia (BACKUP_GPG_RECIPIENT).");
  const [h, o, i] = await Promise.all([gpgPath(gpgBin, homedir), gpgPath(gpgBin, dest), gpgPath(gpgBin, src)]);
  await run(gpgBin, [...gpgArgs(h), "--trust-model", "always", ...recipients.flatMap((r) => ["--recipient", r]), "--output", o, "--encrypt", i]);
}

/** Só no exercício de restauração, com a chave privada guardada fora do executor. */
export async function decryptFile(src, dest, { gpgBin = "gpg", homedir, passphraseFile } = {}) {
  const [h, o, i, pf] = await Promise.all([gpgPath(gpgBin, homedir), gpgPath(gpgBin, dest), gpgPath(gpgBin, src), gpgPath(gpgBin, passphraseFile)]);
  const extra = pf ? ["--pinentry-mode", "loopback", "--passphrase-file", pf] : [];
  await run(gpgBin, [...gpgArgs(h), ...extra, "--output", o, "--decrypt", i]);
}

export function buildManifest({ kind, file, bytes, sha256, createdAt = new Date(), details = {} }) {
  return { version: 1, kind, file, bytes, sha256, createdAt: createdAt.toISOString(), encrypted: file.endsWith(".gpg"), details };
}

export async function writeManifest(dir, manifest) {
  const manifestPath = path.join(dir, `${manifest.file}${MANIFEST_SUFFIX}`);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifestPath;
}

export async function readManifest(manifestPath) {
  return JSON.parse(await fs.readFile(manifestPath, "utf8"));
}

/** Confere o arquivo (criptografado) contra o manifesto: tamanho e SHA-256. Não precisa da chave privada. */
export async function verifyAgainstManifest(dir, manifest) {
  const file = path.join(dir, manifest.file);
  const stat = await fs.stat(file).catch(() => null);
  if (!stat) return { ok: false, reason: "arquivo ausente" };
  if (stat.size !== manifest.bytes) return { ok: false, reason: `tamanho diferente (${stat.size} ≠ ${manifest.bytes})` };
  const actual = await sha256File(file);
  return actual === manifest.sha256 ? { ok: true } : { ok: false, reason: "SHA-256 diferente (arquivo alterado ou corrompido)" };
}

/**
 * Retenção: mantém o mais novo de cada dia nos últimos `daily` dias, de cada semana nas últimas `weekly` semanas
 * e de cada mês nos últimos `monthly` meses; o resto vai para `remove`. Nunca remove o mais recente.
 * Nomes sem data válida são sempre mantidos (nada é apagado por engano).
 */
export function selectRetention(names, now = new Date(), { daily = 7, weekly = 4, monthly = 6 } = {}) {
  const dated = [];
  const keep = new Set();
  for (const name of names) {
    const date = parseStamp(name);
    if (date) dated.push({ name, date });
    else keep.add(name);
  }
  dated.sort((a, b) => b.date - a.date);
  if (dated[0]) keep.add(dated[0].name);

  const DAY = 86400000;
  const dayKey = (d) => d.toISOString().slice(0, 10);
  const monthKey = (d) => d.toISOString().slice(0, 7);
  const weekKey = (d) => {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dow = (t.getUTCDay() + 6) % 7; // segunda = 0
    t.setUTCDate(t.getUTCDate() - dow);
    return t.toISOString().slice(0, 10);
  };
  const seenDay = new Set(), seenWeek = new Set(), seenMonth = new Set();
  for (const { name, date } of dated) {
    const ageDays = (now - date) / DAY;
    const d = dayKey(date), w = weekKey(date), m = monthKey(date);
    if (ageDays < daily && !seenDay.has(d)) keep.add(name);
    if (ageDays < weekly * 7 && !seenWeek.has(w)) keep.add(name);
    if (ageDays < monthly * 31 && !seenMonth.has(m)) keep.add(name);
    seenDay.add(d); seenWeek.add(w); seenMonth.add(m);
  }
  return { keep: [...keep].sort(), remove: names.filter((n) => !keep.has(n)).sort() };
}

/** Procura o manifesto mais recente de um tipo e diz se está dentro do prazo (alerta de backup parado). */
export async function checkFreshness(dir, kind, maxAgeHours, now = new Date()) {
  const entries = (await fs.readdir(dir).catch(() => [])).filter((n) => n.endsWith(MANIFEST_SUFFIX));
  let latest = null;
  for (const name of entries) {
    const manifest = await readManifest(path.join(dir, name)).catch(() => null);
    if (!manifest || manifest.kind !== kind) continue;
    const created = new Date(manifest.createdAt);
    if (!latest || created > latest.created) latest = { created, manifest };
  }
  if (!latest) return { ok: false, reason: `nenhum backup de ${kind} encontrado` };
  const ageHours = (now - latest.created) / 3600000;
  if (ageHours > maxAgeHours) return { ok: false, reason: `último backup de ${kind} tem ${ageHours.toFixed(1)} h (limite ${maxAgeHours} h)`, ageHours };
  return { ok: true, ageHours, file: latest.manifest.file };
}

/** Aviso de sucesso/falha para um monitor externo (healthchecks.io ou equivalente). Falha em avisar não derruba o backup. */
export async function heartbeat(baseUrl, ok, fetchImpl = fetch) {
  if (!baseUrl) return;
  try {
    await fetchImpl(ok ? baseUrl : `${baseUrl.replace(/\/$/, "")}/fail`, { method: "POST", signal: AbortSignal.timeout(10000) });
  } catch {
    /* sem rede para o monitor: o próprio monitor percebe a ausência do aviso */
  }
}

export async function removeIfExists(file) {
  await fs.rm(file, { force: true, recursive: true });
}

/** Aplica a retenção numa pasta: remove arquivos (e seus manifestos) fora da política. */
export async function pruneDir(dir, prefix, now = new Date(), policy = {}, { dryRun = false } = {}) {
  const files = (await fs.readdir(dir)).filter((n) => n.startsWith(`${prefix}-`) && !n.endsWith(MANIFEST_SUFFIX));
  const { keep, remove } = selectRetention(files, now, policy);
  if (!dryRun) {
    for (const name of remove) {
      await removeIfExists(path.join(dir, name));
      await removeIfExists(path.join(dir, `${name}${MANIFEST_SUFFIX}`));
    }
  }
  return { keep, remove };
}
