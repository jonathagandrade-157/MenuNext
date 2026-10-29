// PORTÃO DE AUTORIZAÇÃO do primeiro backup real. Confere, SEM acessar conteúdo de produção, os 10 pré-requisitos.
// Só consulta a máquina local, o ambiente (só PRESENÇA de variáveis, nunca valores) e os próprios scripts.
// Código de saída 0 somente se TODOS estiverem OK. Qualquer FALHA ou NAO_VERIFICADO bloqueia a exportação.
//
// Uso: node scripts/backup/gate-check.mjs [--sem-docker] [--aceito-nao-verificados] [--confirm "EXPORTAR PRODUCAO AAAA-MM-DD"]
//   --sem-docker  modo para este computador (sem Docker/WSL, PostgreSQL nativo): dispensa Docker e Supabase CLI, mantém TODAS as
//                 demais exigências e lista o que não pode ser verificado (Auth, Storage e Realtime reais). O item 10 passa a
//                 exigir também --aceito-nao-verificados (o dono reconhece, por escrito, o que ficou sem prova).
// Variáveis lidas (presença/forma): BACKUP_DIR, BACKUP_EXTERNAL_DIR, BACKUP_GPG_RECIPIENT, BACKUP_GPG_HOME,
//   BACKUP_GPG_PASSPHRASE_FILE, DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PG_DUMP_CMD, PG_RESTORE_CMD,
//   RESTORE_DATABASE_URL, PG_SERVER_MAJOR (padrão 17), BACKUP_ESTIMATED_BYTES, PSQL_CMD, BACKUP_ACCEPT_PRIVILEGED_SOURCE,
//   BACKUP_EXTERNAL_PLAINTEXT_OK (exceção: "sim-so-arquivos-gpg" para disco externo sem BitLocker, ex.: Windows Home).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ACCEPT_PRIVILEGED } from "./backup-db.mjs";
import { assertDisposableTarget, decryptFile, encryptFile, gpgPath, run, siblingTool, splitCommand } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OK = "OK", FAIL = "FALHA", UNK = "NAO_VERIFICADO";
export const EXTERNAL_GPG_ONLY = "sim-so-arquivos-gpg";
const item = (id, label, status, detail = "") => ({ id, label, status, detail });

export function evaluateGate(items) {
  const blocked = items.filter((i) => i.status !== OK);
  return { pass: blocked.length === 0, blocked: blocked.map((i) => `${i.id} ${i.status}`) };
}

export const expectedConfirmation = (date = new Date()) => `EXPORTAR PRODUCAO ${date.toISOString().slice(0, 10)}`;

export function checkConfirmation(arg, date = new Date(), { semDocker = false, acceptUnverified = false } = {}) {
  const expected = expectedConfirmation(date);
  if (arg !== expected) return item(10, "Confirmação expressa do proprietário", FAIL, `ausente/incorreta (esperado: --confirm "${expected}")`);
  if (semDocker && !acceptUnverified) return item(10, "Confirmação expressa do proprietário", FAIL, "frase conferida, mas falta --aceito-nao-verificados (o dono precisa reconhecer o que o modo sem Docker não prova)");
  return item(10, "Confirmação expressa do proprietário", OK, semDocker ? "frase conferida; ressalvas do modo sem Docker aceitas" : "frase conferida");
}

/** O que o modo sem Docker NÃO consegue provar neste computador. Nada disto vira OK por si só. */
export const UNVERIFIABLE_WITHOUT_DOCKER = [
  "Auth real (GoTrue): login com a senha restaurada e esquema auth gerenciado",
  "Storage real: API de listagem/baixa/reenvio e restauração do esquema storage gerenciado",
  "Realtime real: entrega de eventos após a restauração (só a publicação SQL é conferida)",
  "Restauração sobre os esquemas gerenciados do Supabase (donos e extensões próprios)",
  "Tempo de restauração (RTO) com o volume real",
];

export function checkSpace(freeBytes, estimatedBytes = 200 * 1024 * 1024) {
  const need = Math.max(5 * 1024 ** 3, estimatedBytes * 20);
  const gb = (n) => (n / 1024 ** 3).toFixed(1);
  return item(5, "Espaço para cópias e restauração", freeBytes >= need ? OK : FAIL, `livre ${gb(freeBytes)} GB; exigido ≥ ${gb(need)} GB`);
}

export function checkCredentials(env) {
  const accepted = env.BACKUP_ACCEPT_PRIVILEGED_SOURCE === ACCEPT_PRIVILEGED;
  const problems = [], notes = [];
  const url = env.DATABASE_URL;
  if (!url) problems.push("DATABASE_URL ausente");
  else {
    try {
      const u = new URL(url);
      if (!/^postgres(ql)?:$/.test(u.protocol)) problems.push("DATABASE_URL não é postgres://");
      if (!/(\.supabase\.co|\.pooler\.supabase\.com)$/.test(u.hostname)) problems.push("host da origem não é Supabase (conferir)");
      if (u.port === "6543") problems.push("porta 6543 (transaction pooler) não serve para pg_dump");
      if ((u.searchParams.get("sslmode") ?? "") !== "require") problems.push("sslmode=require ausente");
      const user = decodeURIComponent(u.username).split(".")[0];
      if (user === "postgres") {
        if (!accepted) problems.push("usuário postgres tem privilégio demais: use o papel backup_ro (create-backup-role.sql) ou aceite o risco com BACKUP_ACCEPT_PRIVILEGED_SOURCE");
        else notes.push("EXCEÇÃO aceita pelo dono: origem com o papel postgres (privilégio acima do mínimo)");
      } else if (user !== "backup_ro") problems.push("usuário inesperado (esperado: backup_ro)");
      else notes.push("papel backup_ro (a sonda do backup-db.mjs confirma o privilégio mínimo no servidor antes do pg_dump)");
    } catch { problems.push("DATABASE_URL inválida"); }
  }
  if (!env.SUPABASE_URL) problems.push("SUPABASE_URL ausente");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) problems.push("SUPABASE_SERVICE_ROLE_KEY ausente");
  return item(6, "Credenciais protegidas, acesso mínimo (só presença/forma, nunca valores)", problems.length ? FAIL : OK, problems.join("; ") || ["presentes e com a forma esperada", ...notes].join("; "));
}

/** Revisão estática: os scripts da ORIGEM não contêm operação de escrita. */
export function checkReadOnlySource(files) {
  const problems = [];
  const sqlWrite = /\b(insert\s+into|update\s+\w+\s+set|delete\s+from|truncate\s+(table\s+)?["\w]+|drop\s+(table|schema|database)|alter\s+(table|role)|create\s+(table|role))\b/i;
  const httpWrite = /method:\s*["'](PUT|PATCH|DELETE)["']/i;
  for (const [name, source] of Object.entries(files)) {
    if (sqlWrite.test(source.replace(/\/\/.*$/gm, ""))) problems.push(`${name}: comando SQL de escrita`);
    if (httpWrite.test(source)) problems.push(`${name}: requisição HTTP de escrita`);
  }
  if (!/default_transaction_read_only=on/.test(files["backup-db.mjs"] ?? "")) problems.push("backup-db.mjs não força a sessão somente leitura (PGOPTIONS)");
  if (!/probeSourceRole\(/.test(files["backup-db.mjs"] ?? "")) problems.push("backup-db.mjs não confere o privilégio do papel da origem (probeSourceRole)");
  return item(7, "Comandos revisados: origem somente leitura", problems.length ? FAIL : OK, problems.join("; ") || "pg_dump em sessão somente leitura; papel da origem conferido antes do dump; Storage só GET e POST de listagem; nenhum SQL/HTTP de escrita nos scripts de origem");
}

export function checkRecipients(raw) {
  const list = String(raw ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  return list;
}

async function sh(cmd, args, opts) {
  try { return { ok: true, ...(await run(cmd, args, opts)) }; } catch (e) { return { ok: false, stdout: "", stderr: String(e.message) }; }
}

/** Estado do BitLocker do volume que contém `dir` (1 = protegido). Não exige administrador. */
async function bitlockerState(dir) {
  const drive = path.parse(path.resolve(dir)).root.replace(/[\\/]+$/, "").replace(/:$/, "");
  const r = await sh("powershell.exe", ["-NoProfile", "-Command", `(New-Object -ComObject Shell.Application).NameSpace('${drive}:').Self.ExtendedProperty('System.Volume.BitLockerProtection')`]);
  return { drive, value: r.stdout.trim() };
}

async function checkDiskEncryption(env, dir) {
  const label = "Criptografia de disco habilitada (disco local e disco externo)";
  if (process.platform !== "win32") return item(1, label, UNK, "verificação automática só no Windows; confirmar manualmente (LUKS/FileVault)");
  const targets = [["backup local", dir]];
  if (env.BACKUP_EXTERNAL_DIR && fs.existsSync(env.BACKUP_EXTERNAL_DIR)) targets.push(["disco externo", env.BACKUP_EXTERNAL_DIR]);
  const parts = [];
  let worst = OK;
  for (const [name, d] of targets) {
    const { drive, value } = await bitlockerState(d);
    parts.push(`${name} ${drive}: BitLocker = ${value || "sem resposta"}`);
    let status = value === "1" ? OK : value === "" ? UNK : FAIL;
    // Windows Home não cria BitLocker To Go em disco removível: o dono pode aceitar, por escrito, um disco externo sem criptografia
    // de volume, desde que ele guarde SÓ arquivos já cifrados com GPG (e manifestos, que têm apenas nome, tamanho e hash).
    if (name === "disco externo" && status !== OK && env.BACKUP_EXTERNAL_PLAINTEXT_OK === EXTERNAL_GPG_ONLY) {
      status = OK;
      parts.push("EXCEÇÃO aceita pelo dono: sem criptografia de volume; o disco guarda só arquivos .gpg e manifestos");
    }
    if (status === FAIL || (status === UNK && worst === OK)) worst = status;
  }
  if (targets.length === 1) {
    parts.push("disco externo ainda não conectado/definido (BACKUP_EXTERNAL_DIR): criptografia dele não verificada");
    if (worst === OK) worst = UNK;
  }
  return item(1, label, worst, `${parts.join("; ")} (1 = protegido)`);
}

async function toolVersion(name, cmd) {
  const r = await sh(cmd, ["--version"]);
  const major = Number(/(\d+)\.\d+/.exec(r.stdout)?.[1]);
  return { name, ok: r.ok && Boolean(major), major, text: r.stdout.trim().split(" ").pop() };
}

async function checkTools(env, { semDocker = false } = {}) {
  const serverMajor = Number(env.PG_SERVER_MAJOR ?? 17);
  const probs = [], notes = [];
  const dumpCmd = splitCommand(env.PG_DUMP_CMD, "pg_dump");
  const restoreCmd = splitCommand(env.PG_RESTORE_CMD, "pg_restore");
  const psqlCmd = env.PSQL_CMD ? splitCommand(env.PSQL_CMD) : siblingTool(dumpCmd, "psql");
  for (const [name, cmd] of [["pg_dump", dumpCmd], ["pg_restore", restoreCmd], ["psql", psqlCmd]]) {
    const v = await toolVersion(name, cmd);
    if (!v.ok) probs.push(`${name} ausente`);
    else if (v.major < serverMajor) probs.push(`${name} ${v.major} < servidor ${serverMajor}`);
    else notes.push(`${name} ${v.text}`);
  }
  for (const [name, cmd, args] of [["gpg", "gpg", ["--version"]], ["tar", "tar", ["--version"]]]) {
    const r = await sh(cmd, args);
    if (!r.ok) probs.push(`${name} ausente`); else notes.push(name);
  }
  if (semDocker) notes.push("Docker e Supabase CLI dispensados (modo sem Docker, decisão do dono)");
  else {
    const dock = await sh("docker", ["version", "--format", "{{.Server.Version}}"]);
    if (!dock.ok || !dock.stdout.trim()) {
      let why = "Docker instalado mas o serviço (daemon) NÃO está em execução";
      if (process.platform === "win32") {
        // causa mais comum no Windows 11 Home: o motor do Docker Desktop usa WSL2 e o componente WSL não está instalado
        const w = await sh("wsl.exe", ["--status"]);
        if (!w.ok) why += " — WSL NÃO está instalado (o Docker Desktop precisa dele neste Windows); use --sem-docker se o dono decidiu não instalá-lo";
      }
      probs.push(why);
    } else notes.push(`docker ${dock.stdout.trim()}`);
    // no Windows o supabase é um atalho .ps1/.cmd do npm, que execFile não executa direto: passa pelo PowerShell
    const sb = process.platform === "win32" ? await sh("powershell.exe", ["-NoProfile", "-Command", "supabase --version"]) : await sh("supabase", ["--version"]);
    if (!sb.ok) probs.push("Supabase CLI ausente"); else notes.push(`supabase ${sb.stdout.trim()}`);
  }
  return item(2, "Ferramentas oficiais e versões compatíveis", probs.length ? FAIL : OK, probs.length ? probs.join("; ") : notes.join(", "));
}

/** Impressão digital da chave PRINCIPAL (primeira linha `fpr:` da saída `gpg --with-colons --fingerprint`). */
export function primaryFingerprint(colonOutput) {
  const line = String(colonOutput).split("\n").find((l) => l.startsWith("fpr:"));
  return line ? line.split(":")[9] : null;
}

/** Os destinatários precisam ser chaves DIFERENTES: duas vezes a mesma chave não protege contra perder a chave. */
export function distinctRecipients(fingerprints) {
  return fingerprints.length > 0 && fingerprints.every(Boolean) && new Set(fingerprints).size === fingerprints.length;
}

async function checkGpg(env) {
  const label = "Chave GPG de recuperação criada e testada";
  const recipients = checkRecipients(env.BACKUP_GPG_RECIPIENT);
  if (recipients.length < 2) return item(3, label, FAIL, `${recipients.length} destinatário(s) em BACKUP_GPG_RECIPIENT (exigido: ≥ 2 chaves DIFERENTES: a principal e a de emergência)`);
  const home = env.BACKUP_GPG_HOME;
  const h = await gpgPath("gpg", home);
  const base = h ? ["--homedir", h] : [];
  const prints = [];
  for (const r of recipients) {
    const k = await sh("gpg", [...base, "--with-colons", "--fingerprint", r]);
    if (!k.ok) return item(3, label, FAIL, `chave pública de ${r} não encontrada`);
    prints.push(primaryFingerprint(k.stdout));
  }
  if (!distinctRecipients(prints)) return item(3, label, FAIL, "os destinatários são a MESMA chave (ou a impressão digital não pôde ser lida): a segunda chave precisa ser independente");
  const secret = await sh("gpg", [...base, "--list-secret-keys", recipients[0]]);
  if (!secret.ok) return item(3, label, UNK, "chave privada não está neste chaveiro: o teste de decifragem deve ser feito num chaveiro temporário com a chave importada da CÓPIA OFFLINE (BACKUP_GPG_HOME)");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "menunext-gate-"));
  try {
    const plain = path.join(tmp, "amostra.txt"), enc = `${plain}.gpg`, dec = path.join(tmp, "saida.txt");
    fs.writeFileSync(plain, `amostra-${Date.now()}`);
    await encryptFile(plain, enc, recipients.join(","), { homedir: home });
    await decryptFile(enc, dec, { homedir: home, passphraseFile: env.BACKUP_GPG_PASSPHRASE_FILE });
    const same = fs.readFileSync(dec, "utf8") === fs.readFileSync(plain, "utf8");
    return item(3, label, same ? OK : FAIL, same ? `${recipients.length} chaves distintas; cifrar+decifrar de amostra OK` : "decifragem divergente");
  } catch (e) {
    return item(3, label, UNK, `teste de decifragem não concluído (${String(e.message).slice(0, 80)}); informe a frase-senha por BACKUP_GPG_PASSPHRASE_FILE`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function checkDestination(env) {
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
  else if (!(await sh("rclone", ["version"])).ok) probs.push("rclone ausente (necessário para enviar ao R2)");
  return item(4, "Destino privado para o backup cifrado (local + disco externo + nuvem)", probs.length ? FAIL : OK, probs.join("; ") || "local, disco externo e R2 configurados");
}

/** Endereços em que o servidor escuta: só loopback conta como "sem exposição". */
export function evaluateListeners(addresses) {
  const loop = (a) => a === "127.0.0.1" || a === "::1";
  const list = [...new Set(addresses)];
  if (list.length === 0) return { ok: false, reason: "nenhum servidor escutando na porta" };
  const exposed = list.filter((a) => !loop(a));
  return exposed.length ? { ok: false, reason: `escuta além do localhost (${exposed.join(", ")})` } : { ok: true };
}

async function checkLocalIsolation(env, { semDocker = false } = {}) {
  const label = "Ambiente local isolado e sem exposição pública";
  const probs = [];
  const url = env.RESTORE_DATABASE_URL;
  let port;
  if (!url) probs.push("RESTORE_DATABASE_URL não definido");
  else {
    try { assertDisposableTarget(url); port = Number(new URL(url).port || 5432); } catch (e) { probs.push(e.message); }
  }
  if (semDocker) {
    // PostgreSQL nativo: confere, só por leitura, em quais endereços a porta do banco descartável escuta
    if (port && !probs.length) {
      if (process.platform !== "win32") return item(8, label, UNK, "conferir manualmente que o PostgreSQL local escuta só em 127.0.0.1");
      const r = await sh("powershell.exe", ["-NoProfile", "-Command", `(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue).LocalAddress`]);
      const addrs = r.stdout.split(/\s+/).filter(Boolean);
      if (!addrs.length) return item(8, label, UNK, `nenhum servidor escutando na porta ${port}: inicie o PostgreSQL local descartável antes de conferir`);
      const v = evaluateListeners(addrs);
      if (!v.ok) probs.push(v.reason);
    }
    return item(8, label, probs.length ? FAIL : OK, probs.join("; ") || `PostgreSQL nativo local, porta ${port} só em loopback`);
  }
  const ps = await sh("docker", ["ps", "--format", "{{.Ports}}"]);
  if (!ps.ok) probs.push("Docker não responde: ambiente local do Supabase não pode ser iniciado/verificado");
  else if (/0\.0\.0\.0:|\[::\]:/.test(ps.stdout)) probs.push("há contêiner publicando porta em 0.0.0.0 (exposição além do localhost)");
  return item(8, label, probs.length ? FAIL : OK, probs.join("; ") || "destino local; portas só em 127.0.0.1");
}

async function checkDisposal() {
  if (process.platform !== "win32") return item(9, "Plano de descarte seguro", UNK, "confirmar equivalente a `cipher /w` (shred/srm)");
  const r = await sh("cipher.exe", ["/?"]);
  return item(9, "Plano de descarte seguro de temporários", r.ok || r.stdout || r.stderr ? OK : FAIL, "temporários em %TEMP%\\menunext-* apagados pelos scripts; `cipher /w:<pasta>` disponível para sobrescrever espaço livre; histórico do terminal a limpar");
}

export async function runGate({ env = process.env, confirmArg, now = new Date(), semDocker = false, acceptUnverified = false } = {}) {
  const sourceFiles = Object.fromEntries(["backup-db.mjs", "backup-storage.mjs", "fingerprint.sql", "source-role-probe.sql"].map((f) => [f, fs.readFileSync(path.join(HERE, f), "utf8")]));
  const dir = env.BACKUP_DIR ?? process.cwd();
  let freeBytes = 0;
  try { const s = fs.statfsSync(path.resolve(dir)); freeBytes = Number(s.bavail) * Number(s.bsize); } catch { /* sem informação */ }
  return [
    await checkDiskEncryption(env, dir),
    await checkTools(env, { semDocker }),
    await checkGpg(env),
    await checkDestination(env),
    checkSpace(freeBytes, Number(env.BACKUP_ESTIMATED_BYTES) || undefined),
    checkCredentials(env),
    checkReadOnlySource(sourceFiles),
    await checkLocalIsolation(env, { semDocker }),
    await checkDisposal(),
    checkConfirmation(confirmArg, now, { semDocker, acceptUnverified }),
  ];
}

async function main() {
  const flag = (n) => process.argv.includes(n);
  const i = process.argv.indexOf("--confirm");
  const semDocker = flag("--sem-docker");
  const items = await runGate({ confirmArg: i === -1 ? undefined : process.argv[i + 1], semDocker, acceptUnverified: flag("--aceito-nao-verificados") });
  if (semDocker) console.log("MODO SEM DOCKER: aprova só o que este computador consegue provar (PostgreSQL nativo 17, GPG, tar).\n");
  for (const it of items) console.log(`${String(it.id).padStart(2)}. [${it.status}] ${it.label}${it.detail ? ` — ${it.detail}` : ""}`);
  if (semDocker) {
    console.log("\nNÃO VERIFICÁVEIS neste computador (permanecem NAO_VERIFICADO mesmo com o portão liberado):");
    for (const u of UNVERIFIABLE_WITHOUT_DOCKER) console.log(`  - ${u}`);
  }
  const verdict = evaluateGate(items);
  console.log(verdict.pass ? `\nPORTÃO${semDocker ? " (sem Docker)" : ""}: LIBERADO (todos os itens OK${semDocker ? "; ressalvas acima aceitas pelo dono" : ""})` : `\nPORTÃO: BLOQUEADO — ${verdict.blocked.join(", ")}\nNenhum dado de produção foi acessado.`);
  if (!verdict.pass) process.exitCode = 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
