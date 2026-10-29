// Envio dos backups JÁ CIFRADOS para o Cloudflare R2 (API S3) usando o rclone. PREPARADO, NUNCA EXECUTADO contra um R2 real:
// nenhum bucket, token ou conta existe ainda. Sem --executar o script só mostra o plano (nada sai da máquina).
//
// Configuração SOMENTE por variáveis de ambiente do processo (o rclone as lê sozinho; nada vai por argumento nem para arquivo):
//   RCLONE_CONFIG_R2_TYPE=s3   RCLONE_CONFIG_R2_PROVIDER=Cloudflare
//   RCLONE_CONFIG_R2_ACCESS_KEY_ID / RCLONE_CONFIG_R2_SECRET_ACCESS_KEY   (token de Objeto Leitura e Escrita restrito a UM bucket)
//   RCLONE_CONFIG_R2_ENDPOINT=https://<id-da-conta>.r2.cloudflarestorage.com
//   R2_BUCKET=<nome do bucket>        R2_PREFIX=menunext (opcional)      BACKUP_DIR=<pasta local>
// Uso: node scripts/backup/sync-r2.mjs [--executar]
//
// Garantias: só envia arquivos com o nome padrão e conferidos pelo manifesto (SHA-256); `--immutable` impede sobrescrever um
// objeto que já existe com conteúdo diferente (o R2 não tem versionamento S3: a proteção contra apagar/alterar vem da REGRA DE
// RETENÇÃO DO BUCKET — bucket lock — e de nomes únicos com data); o manifesto sobe por último; depois do envio o tamanho
// remoto é conferido contra o manifesto. Não apaga nada no destino (a retenção remota é regra do bucket, não deste script).
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DB_PREFIX } from "./backup-db.mjs";
import { STORAGE_PREFIX } from "./backup-storage.mjs";
import { MANIFEST_SUFFIX, heartbeat, readManifest, redact, run, splitCommand, verifyAgainstManifest } from "./lib.mjs";

const BACKUP_NAME = new RegExp(`^(${DB_PREFIX}-\\d{8}T\\d{6}Z\\.dump|${STORAGE_PREFIX}-\\d{8}T\\d{6}Z\\.tar\\.gz)\\.gpg$`);
const REQUIRED_ENV = ["RCLONE_CONFIG_R2_TYPE", "RCLONE_CONFIG_R2_ACCESS_KEY_ID", "RCLONE_CONFIG_R2_SECRET_ACCESS_KEY", "RCLONE_CONFIG_R2_ENDPOINT", "R2_BUCKET"];

export function missingR2Env(env) {
  const missing = REQUIRED_ENV.filter((k) => !env[k]);
  if (env.RCLONE_CONFIG_R2_TYPE && env.RCLONE_CONFIG_R2_TYPE !== "s3") missing.push("RCLONE_CONFIG_R2_TYPE deve ser s3");
  if (env.RCLONE_CONFIG_R2_ENDPOINT && !/^https:\/\/[a-z0-9]+\.r2\.cloudflarestorage\.com\/?$/i.test(env.RCLONE_CONFIG_R2_ENDPOINT)) missing.push("RCLONE_CONFIG_R2_ENDPOINT não parece um endpoint do R2");
  return missing;
}

export async function syncR2({ srcDir, bucket, prefix = "menunext", rcloneCmd = ["rclone"], execute = false }) {
  if (!srcDir) throw new Error("BACKUP_DIR não definido.");
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket ?? "")) throw new Error("R2_BUCKET inválido (3–63 caracteres: minúsculas, números e hífen).");
  const remote = (name) => `r2:${bucket}/${prefix}/${name}`;
  const names = (await fs.readdir(srcDir)).filter((n) => BACKUP_NAME.test(n)).sort();
  const plan = [], sent = [], failed = [];
  for (const name of names) {
    const manifest = await readManifest(path.join(srcDir, `${name}${MANIFEST_SUFFIX}`)).catch(() => null);
    const check = manifest && manifest.file === name ? await verifyAgainstManifest(srcDir, manifest) : { ok: false, reason: "manifesto ausente" };
    if (!check.ok) { failed.push({ name, reason: `não enviado: ${check.reason}` }); continue; }
    plan.push({ name, bytes: manifest.bytes });
    if (!execute) continue;
    try {
      // o arquivo cifrado primeiro, o manifesto depois (manifesto remoto presente = envio completo)
      await run(rcloneCmd, ["copyto", path.join(srcDir, name), remote(name), "--immutable", "--s3-no-check-bucket", "--checksum"]);
      const listing = await run(rcloneCmd, ["lsjson", "--files-only", remote(name)]);
      const size = JSON.parse(listing.stdout)[0]?.Size;
      if (size !== manifest.bytes) throw new Error(`tamanho remoto ${size} ≠ manifesto ${manifest.bytes}`);
      await run(rcloneCmd, ["copyto", path.join(srcDir, `${name}${MANIFEST_SUFFIX}`), remote(`${name}${MANIFEST_SUFFIX}`), "--immutable", "--s3-no-check-bucket"]);
      sent.push(name);
    } catch (error) {
      failed.push({ name, reason: redact(error instanceof Error ? error.message : error) });
    }
  }
  return { plan, sent, failed, executed: execute };
}

async function main() {
  const execute = process.argv.includes("--executar");
  try {
    const missing = missingR2Env(process.env);
    if (missing.length) throw new Error(`R2 não configurado: ${missing.join(", ")}. Nada foi enviado.`);
    const r = await syncR2({
      srcDir: process.env.BACKUP_DIR, bucket: process.env.R2_BUCKET, prefix: process.env.R2_PREFIX || "menunext",
      rcloneCmd: splitCommand(process.env.RCLONE_CMD, "rclone"), execute,
    });
    if (!execute) {
      console.log(`[sync-r2] SIMULAÇÃO (nada foi enviado). Seriam enviados ${r.plan.length} arquivo(s):`);
      for (const p of r.plan) console.log(`  - ${p.name} (${p.bytes} bytes)`);
    } else console.log(`[sync-r2] enviados ${r.sent.length}, falhas ${r.failed.length}`);
    for (const f of r.failed) console.error(`[sync-r2] ${f.name}: ${f.reason}`);
    if (r.failed.length) process.exitCode = 1;
    if (execute) await heartbeat(process.env.BACKUP_HEARTBEAT_URL, !r.failed.length);
  } catch (error) {
    console.error(`[sync-r2] FALHOU: ${redact(error instanceof Error ? error.message : error)}`);
    if (execute) await heartbeat(process.env.BACKUP_HEARTBEAT_URL, false);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
