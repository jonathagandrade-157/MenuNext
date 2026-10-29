// Backup lógico do PostgreSQL (Supabase): pg_dump -> criptografia com chave pública -> manifesto -> retenção.
//
// Variáveis de ambiente (nada vai por argumento de linha de comando):
//   DATABASE_URL          conexão do banco (use um papel só de leitura quando possível)
//   BACKUP_DIR            pasta de saída (padrão ./backups)
//   BACKUP_GPG_RECIPIENT  e-mail/ID da chave PÚBLICA do dono (a privada NÃO fica no executor)
//   BACKUP_SCHEMAS        esquemas separados por vírgula (padrão public,auth,storage)
//   BACKUP_HEARTBEAT_URL  (opcional) URL do monitor; recebe /fail em caso de erro
//   PG_DUMP_CMD           (opcional) comando do pg_dump (padrão "pg_dump"; precisa ser a versão 17+). Pode ter aspas:
//                         "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe"
//   PSQL_CMD              (opcional) psql 17+ para a sonda do papel; padrão: o psql ao lado do pg_dump
//   BACKUP_ACCEPT_PRIVILEGED_SOURCE  (opcional) "sim-aceito-pelo-dono": permite uma origem com mais privilégio que o mínimo
// Uso: node scripts/backup/backup-db.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  backupStamp, buildManifest, encryptFile, heartbeat, pgEnvFromUrl, pruneDir, redact, removeIfExists, run, sha256File,
  siblingTool, splitCommand, writeManifest,
} from "./lib.mjs";

export const DB_PREFIX = "menunext-db";
export const ACCEPT_PRIVILEGED = "sim-aceito-pelo-dono";
const READ_ONLY_OPTIONS = "-c default_transaction_read_only=on";

/** Interpreta a linha da sonda (source-role-probe.sql). Privilégio mínimo = lê tudo (RLS ignorada) e não escreve em nada. */
export function evaluateSourceRole(line) {
  const f = String(line ?? "").trim().split("|");
  if (f.length !== 9) return { ok: false, role: "?", problems: ["resposta da sonda do papel em formato inesperado"] };
  const [role, superuser, createRole, createDb, replication, bypassRls, readOnly, writableTables, createSchemas] = f;
  const problems = [];
  if (superuser === "t") problems.push("é superusuário");
  if (createRole === "t") problems.push("pode criar papéis");
  if (createDb === "t") problems.push("pode criar bancos");
  if (replication === "t") problems.push("tem replicação");
  if (bypassRls !== "t") problems.push("não ignora RLS (o pg_dump falharia nas tabelas protegidas)");
  if (readOnly !== "on") problems.push("a sessão não está somente leitura");
  if (Number(writableTables) > 0) problems.push(`pode gravar em ${writableTables} tabela(s)`);
  if (Number(createSchemas) > 0) problems.push(`pode criar objetos em ${createSchemas} esquema(s)`);
  return { ok: problems.length === 0, role, problems };
}

/** Sonda SOMENTE LEITURA: pergunta ao servidor o que o papel da conexão consegue fazer (nenhum dado de negócio é lido). */
export async function probeSourceRole({ databaseUrl, schemas, psqlCmd }) {
  const env = { ...pgEnvFromUrl(databaseUrl), PGOPTIONS: READ_ONLY_OPTIONS };
  const probe = fileURLToPath(new URL("./source-role-probe.sql", import.meta.url));
  const { stdout } = await run(psqlCmd, ["-X", "-At", "-F", "|", "-v", "ON_ERROR_STOP=1", "-v", `schemas=${schemas.join(",")}`, "-f", probe], { env });
  return evaluateSourceRole(stdout);
}

export async function runDbBackup({
  databaseUrl, outDir, recipient, schemas = ["public", "auth", "storage"], pgDumpCmd = ["pg_dump"], pgRestoreCmd = ["pg_restore"], psqlCmd = siblingTool(pgDumpCmd, "psql"), excludeTableData = [], gpgBin, gpgHome,
  now = new Date(), retention, checkSourceRole = true, acceptPrivilegedSource = false,
}) {
  if (!databaseUrl) throw new Error("DATABASE_URL não definida.");
  await fs.mkdir(outDir, { recursive: true });
  const stamp = backupStamp(now);
  const plain = path.join(outDir, `${DB_PREFIX}-${stamp}.dump`);
  const encrypted = `${plain}.gpg`;
  let sourceRole = { checked: false };
  try {
    // Defesa em profundidade na ORIGEM: (1) o papel da conexão tem privilégio mínimo (sem escrita, sem DDL) e
    // (2) a sessão é somente leitura. Um papel com mais poder só passa com aceite expresso do dono.
    if (checkSourceRole) {
      const role = await probeSourceRole({ databaseUrl, schemas, psqlCmd });
      if (!role.ok && !acceptPrivilegedSource) {
        throw new Error(`origem recusada: o papel "${role.role}" tem mais privilégio que o mínimo (${role.problems.join("; ")}). Use um papel somente leitura (create-backup-role.sql) ou, se o dono aceitar o risco, defina BACKUP_ACCEPT_PRIVILEGED_SOURCE=${ACCEPT_PRIVILEGED}.`);
      }
      sourceRole = { checked: true, leastPrivilege: role.ok, exceptionAccepted: !role.ok };
    }
    // sessão SOMENTE LEITURA no servidor de origem (o pg_dump já abre transação read-only; isto garante também as demais conexões)
    const env = { ...pgEnvFromUrl(databaseUrl), PGOPTIONS: READ_ONLY_OPTIONS };
    const schemaArgs = schemas.flatMap((s) => ["--schema", s]);
    // tabelas cujo CONTEÚDO não entra no backup (a estrutura entra): sessões e tokens não têm valor de recuperação e são dado sensível
    const excludeArgs = excludeTableData.flatMap((t) => ["--exclude-table-data", t]);
    // Sem --no-privileges de propósito: os GRANTs de anon/authenticated/service_role fazem parte da segurança do app e
    // precisam voltar numa restauração. Sem --no-owner o dump exigiria os mesmos donos; por isso --no-owner fica.
    await run(pgDumpCmd, ["--format=custom", "--no-owner", "--compress=6", ...schemaArgs, ...excludeArgs, "--file", plain], { env });
    const dumpStat = await fs.stat(plain);
    if (dumpStat.size === 0) throw new Error("pg_dump gerou um arquivo vazio.");
    // Auto-verificação ANTES de criptografar: um dump truncado/corrompido passaria no SHA-256 do manifesto (o hash é do
    // arquivo já cifrado), então o conteúdo é lido por pg_restore --list e precisa ter objetos.
    const listing = await run(pgRestoreCmd, ["--list", plain]);
    const entries = listing.stdout.split("\n").filter((l) => l && !l.startsWith(";")).length;
    if (entries === 0) throw new Error("o dump gerado não contém objetos (pg_restore --list vazio).");
    await encryptFile(plain, encrypted, recipient, { gpgBin, homedir: gpgHome });
  } catch (error) {
    await removeIfExists(encrypted);
    throw error;
  } finally {
    await removeIfExists(plain); // o arquivo em texto claro nunca fica no disco
  }
  const stat = await fs.stat(encrypted);
  const manifest = buildManifest({
    kind: "db", file: path.basename(encrypted), bytes: stat.size, sha256: await sha256File(encrypted), createdAt: now,
    details: { schemas, format: "pg_dump custom", recipient, sourceRole },
  });
  await writeManifest(outDir, manifest);
  const pruned = await pruneDir(outDir, DB_PREFIX, now, retention);
  return { manifest, pruned };
}

async function main() {
  const url = process.env.BACKUP_HEARTBEAT_URL;
  try {
    const result = await runDbBackup({
      databaseUrl: process.env.DATABASE_URL,
      outDir: path.resolve(process.env.BACKUP_DIR ?? "backups"),
      recipient: process.env.BACKUP_GPG_RECIPIENT,
      schemas: (process.env.BACKUP_SCHEMAS ?? "public,auth,storage").split(",").map((s) => s.trim()).filter(Boolean),
      pgDumpCmd: splitCommand(process.env.PG_DUMP_CMD, "pg_dump"),
      pgRestoreCmd: splitCommand(process.env.PG_RESTORE_CMD, "pg_restore"),
      psqlCmd: process.env.PSQL_CMD ? splitCommand(process.env.PSQL_CMD) : undefined,
      acceptPrivilegedSource: process.env.BACKUP_ACCEPT_PRIVILEGED_SOURCE === ACCEPT_PRIVILEGED,
      excludeTableData: (process.env.BACKUP_EXCLUDE_DATA ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    });
    console.log(`[backup-db] ok: ${result.manifest.file} (${result.manifest.bytes} bytes, sha256 ${result.manifest.sha256.slice(0, 12)}…)`);
    if (result.pruned.remove.length) console.log(`[backup-db] retenção removeu ${result.pruned.remove.length} arquivo(s) antigo(s)`);
    await heartbeat(url, true);
  } catch (error) {
    console.error(`[backup-db] FALHOU: ${redact(error instanceof Error ? error.message : error)}`);
    await heartbeat(url, false);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
