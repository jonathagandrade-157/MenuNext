// Cópia dos backups JÁ CIFRADOS (.gpg + manifesto) para o DISCO EXTERNO. Não gera backup, não decifra nada e não precisa de chave.
//
// Variáveis: BACKUP_DIR (origem local), BACKUP_EXTERNAL_DIR (disco externo já conectado e já criptografado com BitLocker).
// Uso: node scripts/backup/sync-external.mjs [--dry-run]
//
// Regras de segurança:
//   - só copia arquivos com o nome padrão dos backups (menunext-db-… / menunext-storage-… .gpg) e seus manifestos;
//   - confere o SHA-256 da origem contra o manifesto ANTES de copiar e o do destino DEPOIS (cópia ruim nunca fica);
//   - grava em arquivo temporário (.partial) e só então renomeia; o manifesto é o ÚLTIMO a chegar (manifesto presente = cópia completa);
//   - nunca sobrescreve um arquivo diferente que já exista no destino (conflito = erro);
//   - o disco externo precisa estar conectado (a pasta não é criada) e em OUTRO volume do backup local;
//   - a retenção (7 diários, 4 semanais, 6 mensais) é aplicada no destino pela mesma regra do backup local.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DB_PREFIX } from "./backup-db.mjs";
import { STORAGE_PREFIX } from "./backup-storage.mjs";
import { MANIFEST_SUFFIX, heartbeat, pruneDir, readManifest, redact, removeIfExists, sha256File, verifyAgainstManifest } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_NAME = new RegExp(`^(${DB_PREFIX}-\\d{8}T\\d{6}Z\\.dump|${STORAGE_PREFIX}-\\d{8}T\\d{6}Z\\.tar\\.gz)\\.gpg$`);

const sameVolume = (a, b) => path.parse(path.resolve(a)).root.toLowerCase() === path.parse(path.resolve(b)).root.toLowerCase();
const inside = (child, parent) => { const r = path.relative(path.resolve(parent), path.resolve(child)); return r !== "" && !r.startsWith("..") && !path.isAbsolute(r); };

export async function syncExternal({ srcDir, destDir, now = new Date(), retention, dryRun = false, allowSameVolume = false }) {
  if (!srcDir) throw new Error("BACKUP_DIR não definido.");
  if (!destDir) throw new Error("BACKUP_EXTERNAL_DIR não definido.");
  const dest = await fs.stat(destDir).catch(() => null);
  if (!dest?.isDirectory()) throw new Error("disco externo não está conectado (a pasta de destino não existe; ela não é criada automaticamente).");
  if (!allowSameVolume && sameVolume(srcDir, destDir)) throw new Error("recusado: o disco externo está no MESMO volume do backup local (não é uma segunda cópia).");
  if (inside(destDir, path.resolve(HERE, "../.."))) throw new Error("recusado: o destino está dentro do repositório.");

  const names = (await fs.readdir(srcDir)).filter((n) => BACKUP_NAME.test(n)).sort();
  const result = { copied: [], skipped: [], failed: [], pruned: [] };
  for (const name of names) {
    const manifestName = `${name}${MANIFEST_SUFFIX}`;
    try {
      const manifest = await readManifest(path.join(srcDir, manifestName)).catch(() => null);
      if (!manifest || manifest.file !== name) throw new Error("manifesto ausente ou de outro arquivo");
      const origin = await verifyAgainstManifest(srcDir, manifest);
      if (!origin.ok) throw new Error(`origem não confere com o manifesto (${origin.reason})`);

      const target = path.join(destDir, name);
      const existing = await verifyAgainstManifest(destDir, manifest);
      if (existing.ok && (await fs.stat(path.join(destDir, manifestName)).catch(() => null))) { result.skipped.push(name); continue; }
      if (!existing.ok && existing.reason !== "arquivo ausente") throw new Error(`conflito: já existe um arquivo diferente no destino (${existing.reason}); nada foi sobrescrito`);
      if (dryRun) { result.copied.push(name); continue; }

      const partial = `${target}.partial`;
      try {
        await fs.copyFile(path.join(srcDir, name), partial);
        if ((await sha256File(partial)) !== manifest.sha256) throw new Error("a cópia no disco externo NÃO confere com o SHA-256 do manifesto");
        await fs.rename(partial, target);
      } finally { await removeIfExists(partial); }
      await fs.copyFile(path.join(srcDir, manifestName), path.join(destDir, manifestName));
      result.copied.push(name);
    } catch (error) {
      result.failed.push({ name, reason: redact(error instanceof Error ? error.message : error) });
    }
  }
  // Preserve as copias existentes quando qualquer arquivo da rodada falhar.
  if (!dryRun && result.failed.length === 0) {
    for (const prefix of [DB_PREFIX, STORAGE_PREFIX]) {
      const { remove } = await pruneDir(destDir, prefix, now, retention);
      result.pruned.push(...remove);
    }
  }
  return result;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  try {
    const r = await syncExternal({ srcDir: process.env.BACKUP_DIR, destDir: process.env.BACKUP_EXTERNAL_DIR, dryRun });
    console.log(`[sync-external] ${dryRun ? "SIMULAÇÃO: " : ""}copiados ${r.copied.length}, já existentes ${r.skipped.length}, falhas ${r.failed.length}, removidos pela retenção ${r.pruned.length}`);
    for (const f of r.failed) console.error(`[sync-external] FALHOU ${f.name}: ${f.reason}`);
    if (r.failed.length) process.exitCode = 1;
    await heartbeat(process.env.BACKUP_HEARTBEAT_URL, !r.failed.length);
  } catch (error) {
    console.error(`[sync-external] FALHOU: ${redact(error instanceof Error ? error.message : error)}`);
    await heartbeat(process.env.BACKUP_HEARTBEAT_URL, false);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
