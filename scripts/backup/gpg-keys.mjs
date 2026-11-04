// Chaves GPG do backup: gera as DUAS chaves (principal e emergência), exporta as cópias para guarda offline e PROVA que cada
// chave recupera os dados sozinha, em chaveiro isolado, sem depender do chaveiro original.
//
// Este script NUNCA vê frase-senha: gpg chama o pinentry (janela do Windows) e quem digita é o dono. Nada de segredo vai para
// argumento, variável de ambiente, log ou arquivo versionado. A evidência gravada só tem impressões digitais, datas e hashes de
// DADOS SINTÉTICOS.
//
// Uso (no seu terminal, na raiz do repositório):
//   node scripts/backup/gpg-keys.mjs init                        gera as duas chaves em um chaveiro DEDICADO (não toca ~/.gnupg)
//   node scripts/backup/gpg-keys.mjs status                      mostra impressões digitais, validade e se a privada está aqui
//   node scripts/backup/gpg-keys.mjs export  [--out <pasta>]     grava públicas, privadas e revogações para copiar a mídias offline
//   node scripts/backup/gpg-keys.mjs test --keys-dir <pasta>     recuperação de cada chave em chaveiro isolado (lê as privadas exportadas)
// Variável: BACKUP_GPG_HOME (padrão: ~/.menunext-backup-gnupg). Nenhum comando apaga chave alguma.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  RECOVERY_EVIDENCE_FILE, distinctRecipients, encryptFile, gpgPath, primaryFingerprint, redact, resolveBin, run, sha256File,
} from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const KEY_ROLES = [
  { role: "principal", uid: "MenuNext Backup Principal <backup-principal@menunext.invalid>" },
  { role: "emergencia", uid: "MenuNext Backup Emergencia <backup-emergencia@menunext.invalid>" },
];
export const defaultHome = () => path.join(os.homedir(), ".menunext-backup-gnupg");
export const defaultExportDir = () => path.join(os.homedir(), "menunext-chaves-para-copiar");

/** Pastas que sincronizam com a nuvem ou ficam à vista: chave privada exportada nunca pode ir para lá. */
export function assertSafeExportDir(dir, { repoRoot = path.resolve(HERE, "../.."), home = os.homedir(), env = process.env } = {}) {
  const target = path.resolve(dir).toLowerCase();
  const under = (parent) => { const p = path.resolve(parent).toLowerCase(); return target === p || target.startsWith(p + path.sep); };
  if (under(repoRoot)) throw new Error("recusado: a pasta de exportação está dentro do repositório (chave privada nunca vai para o Git).");
  const risky = ["Documents", "Desktop", "Downloads", "OneDrive", "Documentos", "Área de Trabalho"].map((n) => path.join(home, n));
  for (const k of ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]) if (env[k]) risky.push(env[k]);
  if (risky.some(under) || /[\\/]onedrive/i.test(target)) throw new Error("recusado: pasta sincronizada ou à vista (OneDrive, Documentos, Desktop, Downloads). Use outra pasta ou o próprio pen drive.");
}

const base = async (home, gpgBin) => ["--homedir", await gpgPath(gpgBin, home)];

/** Roda o gpg com o terminal do dono: é assim que o pinentry pede a frase-senha sem passar por este processo. */
function interactive(args, gpgBin = "gpg") {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveBin(gpgBin), args, { stdio: "inherit", windowsHide: false });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`gpg terminou com código ${code}`))));
  });
}

async function gpg(args, gpgBin = "gpg") {
  return run(gpgBin, ["--batch", "--no-tty", ...args]);
}

export async function listKeys({ home, gpgBin = "gpg" } = {}) {
  const b = await base(home, gpgBin);
  const out = [];
  for (const { role, uid } of KEY_ROLES) {
    const r = await gpg([...b, "--with-colons", "--fingerprint", uid], gpgBin).catch(() => null);
    if (!r) { out.push({ role, uid, fingerprint: null }); continue; }
    const fingerprint = primaryFingerprint(r.stdout);
    const pub = r.stdout.split("\n").find((l) => l.startsWith("pub:"))?.split(":");
    const secret = await gpg([...b, "--list-secret-keys", "--with-colons", fingerprint], gpgBin).then(() => true, () => false);
    out.push({ role, uid, fingerprint, expires: pub?.[6] ? new Date(Number(pub[6]) * 1000).toISOString().slice(0, 10) : "nunca", hasSecret: secret });
  }
  return out;
}

export async function generateKey({ home, uid, algo = "rsa4096", expire = "3y", promptForPassphrase = true, gpgBin = "gpg" }) {
  await fs.mkdir(home, { recursive: true });
  const b = await base(home, gpgBin);
  if (promptForPassphrase) return interactive([...b, "--quick-generate-key", uid, algo, "encr", expire], gpgBin);
  // SOMENTE para testes automatizados com chaves descartáveis, sem proteção
  return run(gpgBin, ["--batch", "--no-tty", ...b, "--pinentry-mode", "loopback", "--passphrase", "", "--quick-generate-key", uid, algo, "encr", expire]);
}

export async function exportKeys({ home, outDir, promptForPassphrase = true, gpgBin = "gpg", safetyOptions }) {
  assertSafeExportDir(outDir, safetyOptions);
  const keys = (await listKeys({ home, gpgBin })).filter((k) => k.fingerprint);
  if (keys.length < KEY_ROLES.length) throw new Error("as duas chaves ainda não existem (rode init).");
  await fs.mkdir(outDir, { recursive: true });
  const b = await base(home, gpgBin);
  const written = [];
  for (const k of keys) {
    const pub = path.join(outDir, `chave-publica-${k.role}.asc`);
    const sec = path.join(outDir, `chave-privada-${k.role}.asc`);
    const rev = path.join(outDir, `revogacao-${k.role}.txt`);
    await gpg([...b, "--armor", "--output", await gpgPath(gpgBin, pub), "--export", k.fingerprint], gpgBin);
    const secretArgs = [...b, "--armor", "--output", await gpgPath(gpgBin, sec), "--export-secret-keys", k.fingerprint];
    if (promptForPassphrase) await interactive(secretArgs, gpgBin);
    else await run(gpgBin, ["--batch", "--no-tty", "--pinentry-mode", "loopback", "--passphrase", "", ...secretArgs]);
    // o gpg grava um certificado de revogação ao criar a chave; para usar, apague os dois-pontos antes da linha BEGIN
    await fs.copyFile(path.join(home, "openpgp-revocs.d", `${k.fingerprint}.rev`), rev).catch(() => { throw new Error(`certificado de revogação de ${k.role} não encontrado em openpgp-revocs.d`); });
    written.push(pub, sec, rev);
  }
  const hashes = [];
  for (const f of written) hashes.push(`${await sha256File(f)}  ${path.basename(f)}`);
  await fs.writeFile(path.join(outDir, "HASHES-SHA256.txt"), `${hashes.join("\n")}\n`, "utf8");
  return { outDir, files: written.map((f) => path.basename(f)), keys: keys.map(({ role, fingerprint }) => ({ role, fingerprint })) };
}

/**
 * Prova de recuperação: cifra dados SINTÉTICOS para as duas chaves e, para CADA chave, abre um chaveiro NOVO e VAZIO, importa
 * só a privada exportada daquela chave (lida de `keysDir`, de preferência o pen drive) e decifra. Compara o hash antes/depois.
 */
export async function recoveryTest({ home, keysDir, promptForPassphrase = true, gpgBin = "gpg", now = new Date() }) {
  const keys = (await listKeys({ home, gpgBin })).filter((k) => k.fingerprint);
  if (keys.length < KEY_ROLES.length || !distinctRecipients(keys.map((k) => k.fingerprint))) throw new Error("as duas chaves distintas ainda não existem (rode init).");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "menunext-recovery-"));
  const results = [];
  try {
    const sample = path.join(root, "amostra-sintetica.bin");
    await fs.writeFile(sample, Buffer.concat([Buffer.from(`sintetico ${now.toISOString()}\n`), crypto.randomBytes(256 * 1024)]));
    const sha256Before = await sha256File(sample);
    const encrypted = `${sample}.gpg`;
    await encryptFile(sample, encrypted, keys.map((k) => k.fingerprint).join(","), { gpgBin, homedir: home });

    const isolated = async (name, secretFile) => {
      const iso = path.join(root, `chaveiro-${name}`);
      await fs.mkdir(iso, { recursive: true });
      const b = await base(iso, gpgBin);
      if (secretFile) await gpg([...b, "--import", await gpgPath(gpgBin, secretFile)], gpgBin);
      return { iso, b };
    };
    const kill = (iso) => run("gpgconf", ["--homedir", iso, "--kill", "gpg-agent"]).catch(() => {});

    for (const k of keys) {
      const { iso, b } = await isolated(k.role, path.join(keysDir, `chave-privada-${k.role}.asc`));
      const listed = await gpg([...b, "--list-secret-keys", "--with-colons"], gpgBin);
      const onlyThis = listed.stdout.split("\n").filter((l) => l.startsWith("fpr:")).some((l) => l.split(":")[9] === k.fingerprint)
        && !keys.filter((o) => o.fingerprint !== k.fingerprint).some((o) => listed.stdout.includes(o.fingerprint));
      const out = path.join(root, `recuperado-${k.role}.bin`);
      const decArgs = [...b, "--output", await gpgPath(gpgBin, out), "--decrypt", await gpgPath(gpgBin, encrypted)];
      let recovered = false, sha256After = null, error = null;
      try {
        if (promptForPassphrase) await interactive(decArgs, gpgBin);
        else await run(gpgBin, ["--batch", "--no-tty", "--pinentry-mode", "loopback", "--passphrase", "", ...decArgs]);
        sha256After = await sha256File(out);
        recovered = sha256After === sha256Before;
      } catch (e) { error = redact(e.message); }
      await kill(iso);
      results.push({ role: k.role, fingerprint: k.fingerprint, recovered, isolatedKeyring: onlyThis, sha256Before, sha256After, ...(error ? { error } : {}) });
    }
    // controle negativo: um chaveiro vazio NÃO pode abrir o arquivo
    const empty = await isolated("vazio");
    const denied = await run(gpgBin, ["--batch", "--no-tty", ...empty.b, "--output", await gpgPath(gpgBin, path.join(root, "nao.bin")), "--decrypt", await gpgPath(gpgBin, encrypted)]).then(() => false, () => true);
    await kill(empty.iso);
    const systemRoot = (process.env.SystemDrive ?? "C:").toLowerCase();
    const keysRoot = path.parse(path.resolve(keysDir)).root.replace(/[\\/]+$/, "").toLowerCase();
    const evidence = {
      version: 1, createdAt: now.toISOString(), keys: results, emptyKeyringDenied: denied,
      keysDirOutsideSystemVolume: process.platform === "win32" ? keysRoot !== systemRoot : null,
    };
    if (results.every((r) => r.recovered && r.isolatedKeyring) && denied) await fs.writeFile(path.join(home, RECOVERY_EVIDENCE_FILE), JSON.stringify(evidence, null, 2), "utf8");
    return evidence;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function main() {
  const [cmd] = process.argv.slice(2);
  const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? undefined : process.argv[i + 1]; };
  const home = path.resolve(process.env.BACKUP_GPG_HOME || defaultHome());
  const show = (k) => console.log(`  ${k.role.padEnd(10)} ${k.fingerprint ?? "(ainda não existe)"}${k.fingerprint ? `  validade ${k.expires}  privada neste computador: ${k.hasSecret ? "SIM" : "não"}` : ""}`);
  try {
    if (cmd === "init") {
      console.log(`Chaveiro dedicado: ${home}\nO gpg vai abrir uma janela pedindo a frase-senha de cada chave. Digite-a lá; ela não passa por este programa.\n`);
      for (const { role, uid } of KEY_ROLES) {
        const have = (await listKeys({ home })).find((k) => k.role === role);
        if (have?.fingerprint) { console.log(`Chave ${role} já existe; nada foi alterado.`); continue; }
        console.log(`Gerando a chave ${role}...`);
        await generateKey({ home, uid });
      }
      const keys = await listKeys({ home });
      keys.forEach(show);
      console.log(distinctRecipients(keys.map((k) => k.fingerprint)) ? "\nAs duas chaves são distintas. Próximo passo: export." : "\nATENÇÃO: faltam chaves ou elas não são distintas.");
    } else if (cmd === "status") {
      const keys = await listKeys({ home });
      console.log(`Chaveiro: ${home}`);
      keys.forEach(show);
      const ev = await fs.readFile(path.join(home, RECOVERY_EVIDENCE_FILE), "utf8").then(JSON.parse, () => null);
      console.log(ev ? `Recuperação: comprovada em ${ev.createdAt} (${ev.keys.map((k) => `${k.role}:${k.recovered ? "ok" : "FALHOU"}`).join(", ")}); chaves lidas fora do disco do sistema: ${ev.keysDirOutsideSystemVolume}` : "Recuperação: NÃO comprovada (rode test).");
      console.log("Retirada das chaves privadas deste computador: NÃO é feita por este programa. Só considere depois de test com --keys-dir num pen drive e de conferir as cópias fora desta máquina.");
    } else if (cmd === "export") {
      const r = await exportKeys({ home, outDir: arg("out") ?? defaultExportDir() });
      console.log(`Exportado em ${r.outDir}:\n  ${r.files.join("\n  ")}\nCopie para os pen drives, depois rode test com --keys-dir apontando para o pen drive.`);
    } else if (cmd === "test") {
      const keysDir = arg("keys-dir");
      if (!keysDir) throw new Error("informe --keys-dir <pasta com as chaves exportadas>, de preferência o pen drive.");
      console.log("Para cada chave o gpg pedirá a frase-senha daquela chave (janela do Windows).");
      const ev = await recoveryTest({ home, keysDir: path.resolve(keysDir) });
      for (const k of ev.keys) console.log(`  ${k.role}: ${k.recovered ? "RECUPERADA (hash igual)" : "FALHOU"}${k.isolatedKeyring ? "" : " [chaveiro não isolado]"}`);
      console.log(`  chaveiro vazio não abre o arquivo: ${ev.emptyKeyringDenied ? "sim" : "NÃO (problema)"}`);
      const ok = ev.keys.every((k) => k.recovered && k.isolatedKeyring) && ev.emptyKeyringDenied;
      console.log(ok ? "\nRECUPERAÇÃO INDEPENDENTE COMPROVADA. Evidência gravada (sem segredos)." : "\nRECUPERAÇÃO NÃO COMPROVADA. Nada foi gravado como evidência.");
      if (!ok) process.exitCode = 2;
    } else throw new Error("use: init | status | export | test --keys-dir <pasta>");
  } catch (error) {
    console.error(`[gpg-keys] FALHOU: ${redact(error instanceof Error ? error.message : error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
