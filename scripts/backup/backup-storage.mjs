// Backup dos arquivos do Supabase Storage (bucket restaurant-assets): lista -> baixa -> tar.gz -> criptografa.
//
// Variáveis de ambiente:
//   SUPABASE_URL                 https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    chave de servidor (SÓ no executor do backup; nunca em log nem em arquivo)
//   STORAGE_BUCKET               padrão restaurant-assets
//   BACKUP_DIR, BACKUP_GPG_RECIPIENT, BACKUP_HEARTBEAT_URL   como em backup-db.mjs
// Uso: node scripts/backup/backup-storage.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  backupStamp, buildManifest, encryptFile, heartbeat, pruneDir, redact, removeIfExists, run, sha256File, writeManifest,
} from "./lib.mjs";

export const STORAGE_PREFIX = "menunext-storage";
const PAGE = 100;

/** Nome de objeto seguro para virar caminho local (sem ../, sem caminho absoluto, sem caracteres de controle). */
export function safeObjectPath(name) {
  if (typeof name !== "string" || name.length === 0 || name.length > 1024) return null;
  if (name.startsWith("/") || name.includes("\\") || /[\u0000-\u001f]/.test(name)) return null;
  const parts = name.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  return parts.join("/");
}

function authHeaders(key) {
  return { Authorization: `Bearer ${key}`, apikey: key };
}

/** Lista TODOS os objetos do bucket (percorre as "pastas"). */
export async function listAllObjects({ baseUrl, key, bucket, fetchImpl = fetch }) {
  const objects = [];
  const pending = [""];
  while (pending.length) {
    const prefix = pending.pop();
    for (let offset = 0; ; offset += PAGE) {
      const res = await fetchImpl(`${baseUrl}/storage/v1/object/list/${bucket}`, {
        method: "POST",
        headers: { ...authHeaders(key), "Content-Type": "application/json" },
        body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: "name", order: "asc" } }),
      });
      if (!res.ok) throw new Error(`listagem do Storage falhou (HTTP ${res.status})`);
      const items = await res.json();
      for (const item of items) {
        const full = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id === null || item.id === undefined) pending.push(full); // pasta
        else objects.push(full);
      }
      if (items.length < PAGE) break;
    }
  }
  return objects.sort();
}

export async function runStorageBackup({
  baseUrl, key, bucket = "restaurant-assets", outDir, recipient, gpgBin, gpgHome, now = new Date(), retention,
  fetchImpl = fetch, tarCmd = "tar",
}) {
  if (!baseUrl || !key) throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias.");
  await fs.mkdir(outDir, { recursive: true });
  const stamp = backupStamp(now);
  const staging = path.join(outDir, `.staging-${stamp}`);
  const archive = path.join(outDir, `${STORAGE_PREFIX}-${stamp}.tar.gz`);
  const encrypted = `${archive}.gpg`;
  const files = [];
  const skipped = [];
  try {
    await fs.mkdir(staging, { recursive: true });
    const names = await listAllObjects({ baseUrl, key, bucket, fetchImpl });
    for (const name of names) {
      const safe = safeObjectPath(name);
      if (!safe) { skipped.push(name); continue; }
      const res = await fetchImpl(`${baseUrl}/storage/v1/object/authenticated/${bucket}/${safe.split("/").map(encodeURIComponent).join("/")}`, {
        headers: authHeaders(key),
      });
      if (!res.ok) throw new Error(`download de ${safe} falhou (HTTP ${res.status})`);
      const target = path.join(staging, ...safe.split("/"));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, Buffer.from(await res.arrayBuffer()));
      files.push({ name: safe, bytes: (await fs.stat(target)).size, sha256: await sha256File(target) });
    }
    await fs.writeFile(path.join(staging, "FILES.json"), JSON.stringify(files, null, 2), "utf8");
    // caminhos relativos (cwd = pasta de saída): evita que o tar do Windows/GNU trate "C:" como máquina remota
    await run(tarCmd, ["-czf", path.basename(archive), "-C", path.basename(staging), "."], { cwd: outDir });
    await encryptFile(archive, encrypted, recipient, { gpgBin, homedir: gpgHome });
  } catch (error) {
    await removeIfExists(encrypted);
    throw error;
  } finally {
    await removeIfExists(archive);
    await removeIfExists(staging);
  }
  const stat = await fs.stat(encrypted);
  const manifest = buildManifest({
    kind: "storage", file: path.basename(encrypted), bytes: stat.size, sha256: await sha256File(encrypted), createdAt: now,
    details: { bucket, objects: files.length, skippedUnsafeNames: skipped.length, recipient },
  });
  await writeManifest(outDir, manifest);
  const pruned = await pruneDir(outDir, STORAGE_PREFIX, now, retention);
  return { manifest, pruned, files, skipped };
}

async function main() {
  const url = process.env.BACKUP_HEARTBEAT_URL;
  try {
    const result = await runStorageBackup({
      baseUrl: process.env.SUPABASE_URL?.replace(/\/$/, ""),
      key: process.env.SUPABASE_SERVICE_ROLE_KEY,
      bucket: process.env.STORAGE_BUCKET ?? "restaurant-assets",
      outDir: path.resolve(process.env.BACKUP_DIR ?? "backups"),
      recipient: process.env.BACKUP_GPG_RECIPIENT,
    });
    console.log(`[backup-storage] ok: ${result.manifest.file} (${result.files.length} objetos, ${result.skipped.length} ignorados)`);
    await heartbeat(url, true);
  } catch (error) {
    console.error(`[backup-storage] FALHOU: ${redact(error instanceof Error ? error.message : error)}`);
    await heartbeat(url, false);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
