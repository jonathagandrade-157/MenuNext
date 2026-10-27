// Backup lógico do PostgreSQL (Supabase): pg_dump -> criptografia com chave pública -> manifesto -> retenção.
//
// Variáveis de ambiente (nada vai por argumento de linha de comando):
//   DATABASE_URL          conexão do banco (use um papel só de leitura quando possível)
//   BACKUP_DIR            pasta de saída (padrão ./backups)
//   BACKUP_GPG_RECIPIENT  e-mail/ID da chave PÚBLICA do dono (a privada NÃO fica no executor)
//   BACKUP_SCHEMAS        esquemas separados por vírgula (padrão public,auth,storage)
//   BACKUP_HEARTBEAT_URL  (opcional) URL do monitor; recebe /fail em caso de erro
//   PG_DUMP_CMD           (opcional) comando do pg_dump (padrão "pg_dump"; precisa ser a versão 17+)
// Uso: node scripts/backup/backup-db.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  backupStamp, buildManifest, encryptFile, heartbeat, pgEnvFromUrl, pruneDir, redact, removeIfExists, run, sha256File,
  writeManifest,
} from "./lib.mjs";

export const DB_PREFIX = "menunext-db";

export async function runDbBackup({
  databaseUrl, outDir, recipient, schemas = ["public", "auth", "storage"], pgDumpCmd = ["pg_dump"], pgRestoreCmd = ["pg_restore"], excludeTableData = [], gpgBin, gpgHome,
  now = new Date(), retention,
}) {
  if (!databaseUrl) throw new Error("DATABASE_URL não definida.");
  await fs.mkdir(outDir, { recursive: true });
  const stamp = backupStamp(now);
  const plain = path.join(outDir, `${DB_PREFIX}-${stamp}.dump`);
  const encrypted = `${plain}.gpg`;
  try {
    const env = pgEnvFromUrl(databaseUrl);
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
    details: { schemas, format: "pg_dump custom", recipient },
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
      pgDumpCmd: (process.env.PG_DUMP_CMD ?? "pg_dump").split(" "),
      pgRestoreCmd: (process.env.PG_RESTORE_CMD ?? "pg_restore").split(" "),
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
