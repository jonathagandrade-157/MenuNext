// Verificação e exercício de restauração. Três níveis:
//   1) integridade  (sem chave privada): SHA-256 e tamanho contra o manifesto;
//   2) frescor      (sem chave privada): o último backup de cada tipo é recente?  -> alerta de backup parado;
//   3) restauração  (com a chave privada, em máquina do dono): decifra, confere o conteúdo e, se pedido, restaura em
//      um banco LOCAL descartável (recusa qualquer destino que não seja localhost).
//
// Uso:
//   node scripts/backup/verify-backup.mjs --dir backups --freshness 26          # tipos db e storage
//   node scripts/backup/verify-backup.mjs --dir backups --manifest <arquivo>.manifest.json
//   node scripts/backup/verify-backup.mjs --dir backups --manifest <m> --decrypt --gpg-home <pasta> \
//        [--restore-url postgres://postgres:senha@127.0.0.1:5432/restore_test]
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  MANIFEST_SUFFIX, assertDisposableTarget, checkFreshness, decryptFile, pgEnvFromUrl, readManifest, redact, removeIfExists, run,
  sha256File, verifyAgainstManifest,
} from "./lib.mjs";

export async function verifyIntegrity(dir, manifestPath) {
  const manifest = await readManifest(manifestPath);
  const check = await verifyAgainstManifest(dir, manifest);
  return { manifest, ...check };
}

/** Decifra e confere o conteúdo. Banco: `pg_restore --list` (e restauração opcional). Storage: lista do tar e SHA de cada arquivo. */
export async function verifyRestorable(dir, manifest, { gpgBin, gpgHome, passphraseFile, restoreUrl, pgRestoreCmd = ["pg_restore"], psqlCmd = ["psql"], tarCmd = "tar" } = {}) {
  if (restoreUrl) assertDisposableTarget(restoreUrl);
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "menunext-restore-"));
  try {
    const plain = path.join(work, manifest.file.replace(/\.gpg$/, ""));
    await decryptFile(path.join(dir, manifest.file), plain, { gpgBin, homedir: gpgHome, passphraseFile });
    if (manifest.kind === "db") {
      const { stdout } = await run(pgRestoreCmd, ["--list", plain]);
      const entries = stdout.split("\n").filter((l) => l && !l.startsWith(";")).length;
      if (entries === 0) return { ok: false, reason: "dump sem nenhum objeto" };
      if (restoreUrl) {
        await run(pgRestoreCmd, ["--no-owner", "--clean", "--if-exists", "--exit-on-error", "--dbname", restoreUrl.replace(/:\/\/[^@]*@/, "://"), plain], { env: pgEnvFromUrl(restoreUrl) });
        // objetos que o dump filtrado por esquema não leva (publicação do Realtime): sem isto o Kanban/KDS para de atualizar
        const postRestore = fileURLToPath(new URL("./post-restore.sql", import.meta.url));
        await run(psqlCmd, ["-v", "ON_ERROR_STOP=1", "--quiet", "--dbname", restoreUrl.replace(/:\/\/[^@]*@/, "://"), "-f", postRestore], { env: pgEnvFromUrl(restoreUrl) });
      }
      return { ok: true, entries, restored: Boolean(restoreUrl) };
    }
    const extractDir = path.join(work, "files");
    await fs.mkdir(extractDir);
    await run(tarCmd, ["-xzf", path.basename(plain), "-C", "files"], { cwd: work });
    const listed = JSON.parse(await fs.readFile(path.join(extractDir, "FILES.json"), "utf8"));
    for (const f of listed) {
      const actual = await sha256File(path.join(extractDir, ...f.name.split("/"))).catch(() => null);
      if (actual !== f.sha256) return { ok: false, reason: `arquivo ${f.name} ausente ou corrompido no backup` };
    }
    return { ok: true, files: listed.length };
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
  let failed = false;
  const fresh = arg("freshness");
  if (fresh) {
    const hours = Number(fresh) || 26;
    for (const kind of ["db", "storage"]) {
      const r = await checkFreshness(dir, kind, hours);
      console.log(`[verify] frescor ${kind}: ${r.ok ? `ok (${r.ageHours.toFixed(1)} h)` : `FALHOU - ${r.reason}`}`);
      if (!r.ok) failed = true;
    }
  }
  const manifestArg = arg("manifest");
  if (manifestArg) {
    const manifestPath = path.resolve(dir, String(manifestArg));
    if (!manifestPath.endsWith(MANIFEST_SUFFIX)) throw new Error("informe o arquivo .manifest.json");
    const integrity = await verifyIntegrity(dir, manifestPath);
    console.log(`[verify] integridade ${integrity.manifest.file}: ${integrity.ok ? "ok" : `FALHOU - ${integrity.reason}`}`);
    if (!integrity.ok) failed = true;
    else if (arg("decrypt")) {
      const r = await verifyRestorable(dir, integrity.manifest, {
        gpgHome: arg("gpg-home") ? String(arg("gpg-home")) : undefined,
        passphraseFile: arg("passphrase-file") ? String(arg("passphrase-file")) : undefined,
        restoreUrl: arg("restore-url") ? String(arg("restore-url")) : undefined,
      });
      console.log(`[verify] conteúdo: ${r.ok ? `ok ${JSON.stringify(r)}` : `FALHOU - ${r.reason}`}`);
      if (!r.ok) failed = true;
    }
  }
  if (failed) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    console.error(`[verify] ERRO: ${redact(error instanceof Error ? error.message : error)}`);
    process.exitCode = 1;
  });
}
