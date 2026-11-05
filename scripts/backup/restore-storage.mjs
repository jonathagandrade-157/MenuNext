// Reenvio e validação dos arquivos do backup do Storage para um Storage de TESTE (ou local). Nunca para produção.
//
// Decifra o `.tar.gz.gpg` (precisa da chave privada: máquina do dono), extrai, envia cada objeto para o bucket de destino e
// CONFERE: a lista de objetos do destino bate com a do backup e o SHA-256 de cada arquivo baixado de volta é igual ao do manifesto.
//
// Trava de segurança: só aceita localhost ou um projeto Supabase cujo identificador você confirmar explicitamente em
// `--allow-remote-ref <ref>` E que não esteja em BACKUP_PROTECTED_REFS (coloque aí o identificador da produção).
//
// Variáveis: RESTORE_SUPABASE_URL, RESTORE_SERVICE_ROLE_KEY (chave do projeto de TESTE), BACKUP_PROTECTED_REFS (lista, vírgula).
// Uso: node scripts/backup/restore-storage.mjs --dir backups --manifest <storage>.manifest.json --bucket restaurant-assets \
//        [--allow-remote-ref <ref-do-projeto-de-teste>] [--gpg-home <pasta>] [--passphrase-file <arquivo>]
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { decryptFile, readManifest, redact, removeIfExists, run, sha256File } from "./lib.mjs";
import { listAllObjects, safeObjectPath } from "./backup-storage.mjs";

const TYPES = { ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };

/** Só localhost, ou um projeto de teste confirmado e fora da lista de protegidos (produção). */
export function assertStorageTarget(baseUrl, { allowRemoteRef, protectedRefs = [] } = {}) {
  let url;
  let host;
  try { url = new URL(baseUrl); host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase(); } catch { throw new Error("URL de destino inválida"); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || !["http:", "https:"].includes(url.protocol)) throw new Error("Recusado: use somente a origem HTTP(S), sem credenciais, caminho ou parametros.");
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost")) return { local: true };
  if (url.protocol !== "https:" || url.port) throw new Error("Recusado: o Storage remoto exige HTTPS na porta padrao.");
  const m = /^([a-z0-9]{20})\.supabase\.co$/.exec(host);
  if (!m) throw new Error("Recusado: o destino precisa ser localhost ou um projeto *.supabase.co de TESTE.");
  const ref = m[1];
  if (protectedRefs.map((r) => r.trim().toLowerCase()).filter(Boolean).includes(ref)) throw new Error("Recusado: este projeto está em BACKUP_PROTECTED_REFS (produção).");
  if (allowRemoteRef !== ref) throw new Error("Recusado: confirme o projeto de teste com --allow-remote-ref <ref> igual ao do destino.");
  return { local: false, ref };
}

const headers = (key) => ({ Authorization: `Bearer ${key}`, apikey: key });

export async function runStorageRestore({
  dir, manifest, baseUrl, key, bucket = "restaurant-assets", gpgBin, gpgHome, passphraseFile, allowRemoteRef, protectedRefs = [],
  upsert = false, fetchImpl = fetch, tarCmd = "tar",
}) {
  assertStorageTarget(baseUrl, { allowRemoteRef, protectedRefs }); // antes de decifrar qualquer coisa
  if (manifest.kind !== "storage") throw new Error("o manifesto não é de um backup do Storage");
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "menunext-storage-restore-"));
  try {
    const plain = path.join(work, manifest.file.replace(/\.gpg$/, ""));
    await decryptFile(path.join(dir, manifest.file), plain, { gpgBin, homedir: gpgHome, passphraseFile });
    await fs.mkdir(path.join(work, "files"));
    await run(tarCmd, ["-xzf", path.basename(plain), "-C", "files"], { cwd: work });
    const listed = JSON.parse(await fs.readFile(path.join(work, "files", "FILES.json"), "utf8"));

    const problems = [];
    let uploaded = 0;
    for (const f of listed) {
      const safe = safeObjectPath(f.name);
      if (!safe) { problems.push(`nome inseguro ignorado: ${f.name}`); continue; }
      const file = path.join(work, "files", ...safe.split("/"));
      if ((await sha256File(file).catch(() => null)) !== f.sha256) { problems.push(`arquivo do backup corrompido: ${safe}`); continue; }
      const body = await fs.readFile(file);
      const res = await fetchImpl(`${baseUrl}/storage/v1/object/${bucket}/${safe.split("/").map(encodeURIComponent).join("/")}`, {
        method: "POST",
        headers: { ...headers(key), "Content-Type": TYPES[path.extname(safe).toLowerCase()] ?? "application/octet-stream", "x-upsert": upsert ? "true" : "false" },
        body,
      });
      if (res.ok) uploaded += 1;
      else problems.push(`envio de ${safe} falhou (HTTP ${res.status})${res.status === 404 ? " — o bucket existe no destino?" : ""}`);
    }

    // validação: lista do destino × lista do backup, e SHA-256 de cada objeto baixado de volta
    const remote = await listAllObjects({ baseUrl, key, bucket, fetchImpl });
    const expected = listed.map((f) => f.name).sort();
    const missing = expected.filter((n) => !remote.includes(n));
    let verified = 0;
    for (const f of listed) {
      if (missing.includes(f.name)) continue;
      const res = await fetchImpl(`${baseUrl}/storage/v1/object/authenticated/${bucket}/${f.name.split("/").map(encodeURIComponent).join("/")}`, { headers: headers(key) });
      if (!res.ok) { problems.push(`download de conferência de ${f.name} falhou (HTTP ${res.status})`); continue; }
      const { createHash } = await import("node:crypto");
      const digest = createHash("sha256").update(Buffer.from(await res.arrayBuffer())).digest("hex");
      if (digest === f.sha256) verified += 1; else problems.push(`SHA-256 diferente no destino: ${f.name}`);
    }
    return { ok: problems.length === 0 && missing.length === 0 && verified === listed.length, expected: expected.length, uploaded, verified, missing, problems };
  } finally {
    await removeIfExists(work);
  }
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : (process.argv[i + 1]?.startsWith("--") ? true : (process.argv[i + 1] ?? true));
}

async function main() {
  const dir = path.resolve(String(arg("dir") ?? process.env.BACKUP_DIR ?? "backups"));
  const manifest = await readManifest(path.resolve(dir, String(arg("manifest"))));
  const result = await runStorageRestore({
    dir, manifest,
    baseUrl: process.env.RESTORE_SUPABASE_URL?.replace(/\/$/, ""),
    key: process.env.RESTORE_SERVICE_ROLE_KEY,
    bucket: String(arg("bucket") ?? "restaurant-assets"),
    gpgHome: arg("gpg-home") ? String(arg("gpg-home")) : undefined,
    passphraseFile: arg("passphrase-file") ? String(arg("passphrase-file")) : undefined,
    allowRemoteRef: arg("allow-remote-ref") ? String(arg("allow-remote-ref")) : undefined,
    protectedRefs: (process.env.BACKUP_PROTECTED_REFS ?? "").split(","),
  });
  console.log(`[restore-storage] esperados=${result.expected} enviados=${result.uploaded} conferidos=${result.verified} ausentes=${result.missing.length}`);
  for (const p of result.problems) console.log(`[restore-storage] problema: ${p}`);
  console.log(`[restore-storage] ${result.ok ? "OK" : "FALHOU"}`);
  if (!result.ok) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    console.error(`[restore-storage] ERRO: ${redact(error instanceof Error ? error.message : error)}`);
    process.exitCode = 1;
  });
}
