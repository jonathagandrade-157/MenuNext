// PORTÃO DE AUTORIZAÇÃO do primeiro backup real. Confere, SEM acessar conteúdo de produção, os 10 pré-requisitos.
// Só consulta a máquina local, o ambiente (só PRESENÇA de variáveis, nunca valores) e os próprios scripts.
// Código de saída 0 somente se TODOS estiverem OK. Qualquer FALHA ou NAO_VERIFICADO bloqueia a exportação.
//
// Uso: node scripts/backup/gate-check.mjs [--confirm "EXPORTAR PRODUCAO AAAA-MM-DD"]
// Variáveis lidas (presença/forma): BACKUP_DIR, BACKUP_EXTERNAL_DIR, BACKUP_GPG_RECIPIENT, BACKUP_GPG_HOME,
//   BACKUP_GPG_PASSPHRASE_FILE, DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PG_DUMP_CMD, PG_RESTORE_CMD,
//   RESTORE_DATABASE_URL, PG_SERVER_MAJOR (padrão 17), BACKUP_ESTIMATED_BYTES.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertDisposableTarget, decryptFile, encryptFile, gpgPath, run } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OK = "OK", FAIL = "FALHA", UNK = "NAO_VERIFICADO";
const item = (id, label, status, detail = "") => ({ id, label, status, detail });

export function evaluateGate(items) {
  const blocked = items.filter((i) => i.status !== OK);
  return { pass: blocked.length === 0, blocked: blocked.map((i) => `${i.id} ${i.status}`) };
}

export const expectedConfirmation = (date = new Date()) => `EXPORTAR PRODUCAO ${date.toISOString().slice(0, 10)}`;

export function checkConfirmation(arg, date = new Date()) {
  const expected = expectedConfirmation(date);
  return item(10, "Confirmação expressa do proprietário", arg === expected ? OK : FAIL, arg === expected ? "frase conferida" : `ausente/incorreta (esperado: --confirm "${expected}")`);
}

export function checkSpace(freeBytes, estimatedBytes = 200 * 1024 * 1024) {
  const need = Math.max(5 * 1024 ** 3, estimatedBytes * 20);
  const gb = (n) => (n / 1024 ** 3).toFixed(1);
  return item(5, "Espaço para cópias e restauração", freeBytes >= need ? OK : FAIL, `livre ${gb(freeBytes)} GB; exigido ≥ ${gb(need)} GB`);
}

export function checkCredentials(env) {
  const problems = [];
  const url = env.DATABASE_URL;
  if (!url) problems.push("DATABASE_URL ausente");
  else {
    try {
      const u = new URL(url);
      if (!/^postgres(ql)?:$/.test(u.protocol)) problems.push("DATABASE_URL não é postgres://");
      if (!/(\.supabase\.co|\.pooler\.supabase\.com)$/.test(u.hostname)) problems.push("host da origem não é Supabase (conferir)");
      if (u.port === "6543") problems.push("porta 6543 (transaction pooler) não serve para pg_dump");
      if ((u.searchParams.get("sslmode") ?? "") !== "require") problems.push("sslmode=require ausente");
      if (!["postgres", "backup_ro"].includes(decodeURIComponent(u.username).split(".")[0])) problems.push("usuário inesperado");
    } catch { problems.push("DATABASE_URL inválida"); }
  }
  if (!env.SUPABASE_URL) problems.push("SUPABASE_URL ausente");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) problems.push("SUPABASE_SERVICE_ROLE_KEY ausente");
  return item(6, "Credenciais protegidas, acesso mínimo (só presença/forma, nunca valores)", problems.length ? FAIL : OK, problems.join("; ") || "presentes e com a forma esperada");
}

/** Revisão estática: os scripts da ORIGEM não contêm operação de escrita. */
export function checkReadOnlySource(files) {
  const problems = [];
  const sqlWrite = /\b(insert\s+into|update\s+\w+\s+set|delete\s+from|truncate|drop\s+(table|schema|database)|alter\s+(table|role)|create\s+(table|role))\b/i;
  const httpWrite = /method:\s*["'](PUT|PATCH|DELETE)["']/i;
  for (const [name, source] of Object.entries(files)) {
    if (sqlWrite.test(source.replace(/\/\/.*$/gm, ""))) problems.push(`${name}: comando SQL de escrita`);
    if (httpWrite.test(source)) problems.push(`${name}: requisição HTTP de escrita`);
  }
  if (!/default_transaction_read_only=on/.test(files["backup-db.mjs"] ?? "")) problems.push("backup-db.mjs não força a sessão somente leitura (PGOPTIONS)");
  return item(7, "Comandos revisados: origem somente leitura", problems.length ? FAIL : OK, problems.join("; ") || "pg_dump em sessão somente leitura; Storage só GET e POST de listagem; nenhum SQL/HTTP de escrita nos scripts de origem");
}

export function checkRecipients(raw) {
  const list = String(raw ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  return list;
}

async function sh(cmd, args, opts) {
  try { return { ok: true, ...(await run(cmd, args, opts)) }; } catch (e) { return { ok: false, stdout: "", stderr: String(e.message) }; }
}

async function checkDiskEncryption(dir) {
  if (process.platform !== "win32") return item(1, "Criptografia de disco", UNK, "verificação automática só no Windows; confirmar manualmente (LUKS/FileVault)");
  const drive = path.parse(path.resolve(dir)).root.replace(/[\\/]+$/, "").replace(/:$/, "");
  const r = await sh("powershell.exe", ["-NoProfile", "-Command", `(New-Object -ComObject Shell.Application).NameSpace('${drive}:').Self.ExtendedProperty('System.Volume.BitLockerProtection')`]);
  const v = r.stdout.trim();
  return item(1, "Criptografia de disco habilitada", v === "1" ? OK : v === "" ? UNK : FAIL, `BitLocker em ${drive}: = ${v || "sem resposta"} (1 = protegido)`);
}

async function checkTools(env) {
  const serverMajor = Number(env.PG_SERVER_MAJOR ?? 17);
  const probs = [], notes = [];
  for (const [name, cmd] of [["pg_dump", (env.PG_DUMP_CMD ?? "pg_dump").split(" ")], ["pg_restore", (env.PG_RESTORE_CMD ?? "pg_restore").split(" ")]]) {
    const r = await sh(cmd, ["--version"]);
    const major = Number(/(\d+)\.\d+/.exec(r.stdout)?.[1]);
    if (!r.ok || !major) probs.push(`${name} ausente`);
    else if (major < serverMajor) probs.push(`${name} ${major} < servidor ${serverMajor}`);
    else notes.push(`${name} ${r.stdout.trim().split(" ").pop()}`);
  }
  for (const [name, cmd, args] of [["gpg", "gpg", ["--version"]], ["tar", "tar", ["--version"]]]) {
    const r = await sh(cmd, args);
    if (!r.ok) probs.push(`${name} ausente`); else notes.push(name);
  }
  const dock = await sh("docker", ["version", "--format", "{{.Server.Version}}"]);
  if (!dock.ok || !dock.stdout.trim()) {
    let why = "Docker instalado mas o serviço (daemon) NÃO está em execução";
    if (process.platform === "win32") {
      // causa mais comum no Windows 11 Home: o motor do Docker Desktop usa WSL2 e o componente WSL não está instalado
      const w = await sh("wsl.exe", ["--status"]);
      if (!w.ok) why += " — WSL NÃO está instalado (o Docker Desktop precisa dele neste Windows)";
    }
    probs.push(why);
  } else notes.push(`docker ${dock.stdout.trim()}`);
  // no Windows o supabase é um atalho .ps1/.cmd do npm, que execFile não executa direto: passa pelo PowerShell
  const sb = process.platform === "win32" ? await sh("powershell.exe", ["-NoProfile", "-Command", "supabase --version"]) : await sh("supabase", ["--version"]);
  if (!sb.ok) probs.push("Supabase CLI ausente"); else notes.push(`supabase ${sb.stdout.trim()}`);
  return item(2, "Ferramentas oficiais e versões compatíveis", probs.length ? FAIL : OK, probs.length ? probs.join("; ") : notes.join(", "));
}

async function checkGpg(env) {
  const recipients = checkRecipients(env.BACKUP_GPG_RECIPIENT);
  if (recipients.length < 2) return item(3, "Chave GPG de recuperação criada e testada", FAIL, `${recipients.length} destinatário(s) em BACKUP_GPG_RECIPIENT (exigido: ≥ 2, dono + emergência)`);
  const home = env.BACKUP_GPG_HOME;
  const h = await gpgPath("gpg", home);
  const base = h ? ["--homedir", h] : [];
  for (const r of recipients) {
    if (!(await sh("gpg", [...base, "--list-keys", r])).ok) return item(3, "Chave GPG de recuperação criada e testada", FAIL, `chave pública de ${r} não encontrada`);
  }
  const secret = await sh("gpg", [...base, "--list-secret-keys", recipients[0]]);
  if (!secret.ok) return item(3, "Chave GPG de recuperação criada e testada", UNK, "chave privada não está neste chaveiro: o teste de decifragem deve ser feito com a chave vinda do cofre");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "menunext-gate-"));
  try {
    const plain = path.join(tmp, "amostra.txt"), enc = `${plain}.gpg`, dec = path.join(tmp, "saida.txt");
    fs.writeFileSync(plain, `amostra-${Date.now()}`);
    await encryptFile(plain, enc, recipients.join(","), { homedir: home });
    await decryptFile(enc, dec, { homedir: home, passphraseFile: env.BACKUP_GPG_PASSPHRASE_FILE });
    const same = fs.readFileSync(dec, "utf8") === fs.readFileSync(plain, "utf8");
    return item(3, "Chave GPG de recuperação criada e testada", same ? OK : FAIL, same ? `${recipients.length} destinatários; cifrar+decifrar de amostra OK` : "decifragem divergente");
  } catch (e) {
    return item(3, "Chave GPG de recuperação criada e testada", UNK, `teste de decifragem não concluído (${String(e.message).slice(0, 80)}); informe a frase-senha por BACKUP_GPG_PASSPHRASE_FILE`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

function checkDestination(env) {
  const probs = [];
  const dir = env.BACKUP_DIR;
  if (!dir) probs.push("BACKUP_DIR não definido");
  else {
    try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); } catch { probs.push("BACKUP_DIR sem permissão de escrita"); }
    const repo = path.resolve(HERE, "../..");
    if (path.resolve(dir).startsWith(repo + path.sep) && !/[\\/]backups([\\/]|$)/.test(path.relative(repo, path.resolve(dir)))) probs.push("BACKUP_DIR dentro do repositório fora de /backups (não ignorado pelo Git)");
  }
  const ext = env.BACKUP_EXTERNAL_DIR;
  if (!ext) probs.push("BACKUP_EXTERNAL_DIR (disco externo) não definido");
  else if (!fs.existsSync(ext)) probs.push("disco externo não está conectado");
  else if (dir && path.parse(path.resolve(ext)).root.toLowerCase() === path.parse(path.resolve(dir)).root.toLowerCase()) probs.push("disco externo está no MESMO volume do backup local");
  const cloud = env.RCLONE_CONFIG_R2_TYPE && env.RCLONE_CONFIG_R2_ACCESS_KEY_ID && env.RCLONE_CONFIG_R2_SECRET_ACCESS_KEY && env.RCLONE_CONFIG_R2_ENDPOINT;
  if (!cloud) probs.push("destino em nuvem (R2) não configurado (RCLONE_CONFIG_R2_*)");
  return item(4, "Destino privado para o backup cifrado (local + disco externo + nuvem)", probs.length ? FAIL : OK, probs.join("; ") || "local, disco externo e R2 configurados");
}

async function checkLocalIsolation(env) {
  const probs = [];
  const url = env.RESTORE_DATABASE_URL;
  if (!url) probs.push("RESTORE_DATABASE_URL não definido");
  else { try { assertDisposableTarget(url); } catch (e) { probs.push(e.message); } }
  const ps = await sh("docker", ["ps", "--format", "{{.Ports}}"]);
  if (!ps.ok) probs.push("Docker não responde: ambiente local do Supabase não pode ser iniciado/verificado");
  else if (/0\.0\.0\.0:|\[::\]:/.test(ps.stdout)) probs.push("há contêiner publicando porta em 0.0.0.0 (exposição além do localhost)");
  return item(8, "Ambiente local isolado e sem exposição pública", probs.length ? FAIL : OK, probs.join("; ") || "destino local; portas só em 127.0.0.1");
}

async function checkDisposal() {
  if (process.platform !== "win32") return item(9, "Plano de descarte seguro", UNK, "confirmar equivalente a `cipher /w` (shred/srm)");
  const r = await sh("cipher.exe", ["/?"]);
  return item(9, "Plano de descarte seguro de temporários", r.ok || r.stdout || r.stderr ? OK : FAIL, "temporários em %TEMP%\\menunext-* apagados pelos scripts; `cipher /w:<pasta>` disponível para sobrescrever espaço livre; histórico do terminal a limpar");
}

export async function runGate({ env = process.env, confirmArg, now = new Date() } = {}) {
  const sourceFiles = Object.fromEntries(["backup-db.mjs", "backup-storage.mjs", "fingerprint.sql"].map((f) => [f, fs.readFileSync(path.join(HERE, f), "utf8")]));
  const dir = env.BACKUP_DIR ?? process.cwd();
  let freeBytes = 0;
  try { const s = fs.statfsSync(path.resolve(dir)); freeBytes = Number(s.bavail) * Number(s.bsize); } catch { /* sem informação */ }
  return [
    await checkDiskEncryption(dir),
    await checkTools(env),
    await checkGpg(env),
    checkDestination(env),
    checkSpace(freeBytes, Number(env.BACKUP_ESTIMATED_BYTES) || undefined),
    checkCredentials(env),
    checkReadOnlySource(sourceFiles),
    await checkLocalIsolation(env),
    await checkDisposal(),
    checkConfirmation(confirmArg, now),
  ];
}

async function main() {
  const i = process.argv.indexOf("--confirm");
  const items = await runGate({ confirmArg: i === -1 ? undefined : process.argv[i + 1] });
  for (const it of items) console.log(`${String(it.id).padStart(2)}. [${it.status}] ${it.label}${it.detail ? ` — ${it.detail}` : ""}`);
  const verdict = evaluateGate(items);
  console.log(verdict.pass ? "\nPORTÃO: LIBERADO (todos os itens OK)" : `\nPORTÃO: BLOQUEADO — ${verdict.blocked.join(", ")}\nNenhum dado de produção foi acessado.`);
  if (!verdict.pass) process.exitCode = 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
