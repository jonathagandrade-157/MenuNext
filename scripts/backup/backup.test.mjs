import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertDisposableTarget, backupStamp, checkFreshness, gpgPath, heartbeat, parseStamp, pgEnvFromUrl, pruneDir, redact, selectRetention,
  buildManifest, sha256File, siblingTool, splitCommand, writeManifest,
} from "./lib.mjs";
import { ACCEPT_PRIVILEGED, evaluateSourceRole, runDbBackup } from "./backup-db.mjs";
import { listAllObjects, runStorageBackup, safeObjectPath } from "./backup-storage.mjs";
import { verifyIntegrity, verifyRestorable } from "./verify-backup.mjs";
import { syncExternal } from "./sync-external.mjs";
import { missingR2Env, syncR2 } from "./sync-r2.mjs";
import { assertStorageTarget, runStorageRestore } from "./restore-storage.mjs";
import {
  UNVERIFIABLE_WITHOUT_DOCKER, checkConfirmation, checkCredentials, checkReadOnlySource, checkSpace, distinctRecipients, evaluateGate, evaluateListeners, expectedConfirmation,
  primaryFingerprint,
} from "./gate-check.mjs";

// Verificações do PIPELINE dos scripts com ferramentas simuladas: um `pg_dump` falso e um Storage falso. Não provam que o
// pg_dump/pg_restore reais funcionam contra o Supabase (essas ferramentas não existem no laboratório): ver README.

const hasGpg = (() => {
  try { execFileSync("gpg", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
})();
const hasTar = (() => {
  try { execFileSync("tar", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
})();

describe("nomes e datas", () => {
  it("backupStamp e parseStamp são inversos", () => {
    const d = new Date("2026-10-27T03:15:00Z");
    expect(backupStamp(d)).toBe("20261027T031500Z");
    expect(parseStamp("menunext-db-20261027T031500Z.dump.gpg")?.toISOString()).toBe("2026-10-27T03:15:00.000Z");
    expect(parseStamp("qualquer-coisa.txt")).toBeNull();
  });
});

describe("retenção", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const name = (iso) => `menunext-db-${backupStamp(new Date(iso))}.dump.gpg`;
  const policy = { daily: 7, weekly: 4, monthly: 6 };

  it("mantém um por dia na última semana, um por semana no último mês e um por mês no último semestre", () => {
    const names = [];
    for (let i = 0; i < 90; i++) names.push(name(new Date(now.getTime() - i * 86400000 - 3600000).toISOString()));
    const { keep, remove } = selectRetention(names, now, policy);
    expect(keep.length).toBeGreaterThanOrEqual(7);
    expect(keep.length).toBeLessThan(25);
    expect(remove.length + keep.length).toBe(names.length);
    const newest = names[0];
    expect(keep).toContain(newest);
    for (let i = 0; i < 7; i++) expect(keep).toContain(names[i]); // última semana inteira
  });

  it("nunca remove o mais recente, mesmo com política mínima", () => {
    const names = [name("2026-10-27T03:00:00Z"), name("2026-10-26T03:00:00Z")];
    const { keep } = selectRetention(names, now, { daily: 0, weekly: 0, monthly: 0 });
    expect(keep).toContain(names[0]);
  });

  it("nomes sem data válida nunca são removidos", () => {
    const { remove } = selectRetention(["README.txt", "menunext-db-lixo.dump.gpg"], now, policy);
    expect(remove).toEqual([]);
  });

  it("vários no mesmo dia: fica o mais novo", () => {
    const a = name("2026-10-20T03:00:00Z");
    const b = name("2026-10-20T15:00:00Z");
    const { keep, remove } = selectRetention([a, b, name("2026-10-27T03:00:00Z")], now, { daily: 1, weekly: 1, monthly: 1 });
    expect(keep).not.toContain(a);
    expect(remove).toContain(a);
    expect(keep).toContain(b); // o mais novo do dia/semana/mês é o que fica
  });
});

describe("segredos e destino da restauração", () => {
  it("pgEnvFromUrl separa a senha em variáveis de ambiente", () => {
    const env = pgEnvFromUrl("postgresql://postgres:s%40nha@db.exemplo.supabase.co:5432/postgres?sslmode=require");
    expect(env).toMatchObject({ PGHOST: "db.exemplo.supabase.co", PGUSER: "postgres", PGPASSWORD: "s@nha", PGPORT: "5432" });
    expect(() => pgEnvFromUrl("mysql://x")).toThrow();
  });

  it("redact esconde senha de URL, Bearer e token=", () => {
    const text = redact("postgres://u:segredo123@host/db Bearer abcdefghij1234 token=xyz789");
    expect(text).not.toContain("segredo123");
    expect(text).not.toContain("abcdefghij1234");
    expect(text).not.toContain("xyz789");
  });

  it("a restauração de teste recusa qualquer destino fora da máquina local", () => {
    expect(() => assertDisposableTarget("postgres://u:p@127.0.0.1:5432/x")).not.toThrow();
    expect(() => assertDisposableTarget("postgres://u:p@localhost/x")).not.toThrow();
    expect(() => assertDisposableTarget("postgres://u:p@[::1]/x")).not.toThrow();
    expect(() => assertDisposableTarget("postgres://u:p@db.zsqxaxqiyqbdljsiuoho.supabase.co:5432/postgres")).toThrow(/Recusado/);
    expect(() => assertDisposableTarget("postgres://u:p@10.0.0.5/x")).toThrow(/Recusado/);
    expect(() => assertDisposableTarget("isto não é url")).toThrow();
  });

  it("safeObjectPath recusa travessia de diretório e nomes estranhos", () => {
    expect(safeObjectPath("loja/produto/foto.webp")).toBe("loja/produto/foto.webp");
    for (const bad of ["../x", "a/../../x", "/abs", "a\\b", "a//b", "", "a/./b", "a\u0000b"]) expect(safeObjectPath(bad), bad).toBeNull();
  });
});

describe("comandos e papel da origem", () => {
  it("splitCommand respeita aspas (caminho do Windows com espaço) e usa o padrão quando vazio", () => {
    const exe = String.raw`C:\Program Files\PostgreSQL\17\bin\pg_dump.exe`;
    expect(splitCommand(`"${exe}"`, "pg_dump")).toEqual([exe]);
    expect(splitCommand(String.raw`node "a b\x.mjs" --flag`, "x")).toEqual(["node", String.raw`a b\x.mjs`, "--flag"]);
    expect(splitCommand("", "pg_dump")).toEqual(["pg_dump"]);
    expect(splitCommand(undefined, ["pg_restore"])).toEqual(["pg_restore"]);
  });

  it("siblingTool acha o psql na pasta do pg_dump e cai no PATH quando não há pasta", () => {
    const exe = String.raw`C:\Program Files\PostgreSQL\17\bin\pg_dump.exe`;
    expect(siblingTool([exe], "psql")).toEqual([path.join(path.dirname(exe), "psql.exe")]);
    expect(siblingTool(["pg_dump"], "psql")).toEqual(["psql"]);
  });

  it("evaluateSourceRole: só o papel somente leitura que ignora RLS é privilégio mínimo", () => {
    expect(evaluateSourceRole("backup_ro|f|f|f|f|t|on|0|0").ok).toBe(true);
    expect(evaluateSourceRole("postgres|f|t|t|f|t|on|30|2").problems.join(";")).toMatch(/criar papéis.*criar bancos.*30 tabela.*2 esquema/);
    expect(evaluateSourceRole("root|t|t|t|t|t|on|0|0").problems).toContain("é superusuário");
    expect(evaluateSourceRole("x|f|f|f|f|f|on|0|0").problems.join()).toMatch(/não ignora RLS/);
    expect(evaluateSourceRole("x|f|f|f|f|t|off|0|0").problems.join()).toMatch(/não está somente leitura/);
    expect(evaluateSourceRole("").ok).toBe(false); // resposta vazia nunca aprova
    expect(ACCEPT_PRIVILEGED).toBe("sim-aceito-pelo-dono");
  });
});

describe("heartbeat", () => {
  it("avisa sucesso na URL e falha em /fail; erro de rede não derruba", async () => {
    const calls = [];
    const ok = async (url) => { calls.push(url); return new Response(null, { status: 200 }); };
    await heartbeat("https://monitor.test/abc", true, ok);
    await heartbeat("https://monitor.test/abc/", false, ok);
    expect(calls).toEqual(["https://monitor.test/abc", "https://monitor.test/abc/fail"]);
    await expect(heartbeat("https://monitor.test/abc", true, (async () => { throw new Error("rede"); }))).resolves.toBeUndefined();
    await expect(heartbeat(undefined, true)).resolves.toBeUndefined();
  });
});

describe.skipIf(!hasGpg || !hasTar)("pipeline completo (gpg + tar reais, pg_dump e Storage simulados)", () => {
  let tmp;
  let gpgHome;
  let fakePgDump;
  let fakePgRestore;
  let fakePsql;
  const recipient = "backup-teste@menunext.invalid";

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "menunext-backup-test-"));
    gpgHome = path.join(tmp, "gnupg");
    await fs.mkdir(gpgHome, { recursive: true });
    const params = path.join(tmp, "key-params.txt");
    await fs.writeFile(params, `%no-protection
Key-Type: RSA
Key-Length: 2048
Name-Real: Backup Teste
Name-Email: ${recipient}
Expire-Date: 0
%commit
`);
    execFileSync("gpg", ["--batch", "--homedir", await gpgPath("gpg", gpgHome), "--generate-key", await gpgPath("gpg", params)], { stdio: "pipe" });
    fakePgRestore = path.join(tmp, "fake-pg-restore.mjs");
    await fs.writeFile(fakePgRestore, `console.log("; Archive falso\\n1; 1259 16385 TABLE public orders postgres");`);
    fakePsql = path.join(tmp, "fake-psql.mjs");
    await fs.writeFile(
      fakePsql,
      `import fs from "node:fs";
fs.writeFileSync(process.env.FAKE_PSQL_LOG, JSON.stringify({ argv: process.argv.slice(2), pgoptions: process.env.PGOPTIONS, pgpassword: process.env.PGPASSWORD }));
console.log(process.env.FAKE_ROLE_LINE);
`
    );
    fakePgDump = path.join(tmp, "fake-pg-dump.mjs");
    await fs.writeFile(
      fakePgDump,
      `import fs from "node:fs";
const i = process.argv.indexOf("--file");
fs.writeFileSync(process.argv[i + 1], "PGDMP-FALSO conteudo do banco de teste\\n");
fs.writeFileSync(process.env.FAKE_LOG, JSON.stringify({ argv: process.argv.slice(2), pgpassword: process.env.PGPASSWORD, pghost: process.env.PGHOST }));
`
    );
  }, 90000);

  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("backup do banco: criptografa, apaga o texto claro, grava manifesto e a senha nunca vai em argumento", async () => {
    const out = path.join(tmp, "db");
    process.env.FAKE_LOG = path.join(tmp, "fake-log.json");
    const { manifest } = await runDbBackup({ checkSourceRole: false,
      databaseUrl: "postgresql://postgres:SENHA-SECRETA@db.exemplo.supabase.co:5432/postgres",
      outDir: out, recipient, gpgHome, pgDumpCmd: [process.execPath, fakePgDump], pgRestoreCmd: [process.execPath, fakePgRestore], now: new Date("2026-10-27T03:00:00Z"),
    });
    const files = await fs.readdir(out);
    expect(files.some((f) => f.endsWith(".dump"))).toBe(false); // sem texto claro
    expect(files).toContain(manifest.file);
    const encrypted = await fs.readFile(path.join(out, manifest.file));
    expect(encrypted.includes(Buffer.from("PGDMP-FALSO"))).toBe(false); // conteúdo não aparece no arquivo
    const log = JSON.parse(await fs.readFile(process.env.FAKE_LOG, "utf8"));
    expect(JSON.stringify(log.argv)).not.toContain("SENHA-SECRETA");
    expect(log.pgpassword).toBe("SENHA-SECRETA");
    expect(log.pghost).toBe("db.exemplo.supabase.co");
    expect(manifest.encrypted).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain("SENHA-SECRETA");

    const integrity = await verifyIntegrity(out, path.join(out, `${manifest.file}.manifest.json`));
    expect(integrity.ok).toBe(true);
  }, 60000);

  it("vários destinatários: o arquivo carrega uma chave de sessão para CADA chave (perder uma não perde o backup)", async () => {
    const second = "emergencia-teste@menunext.invalid";
    const params2 = path.join(tmp, "key-params2.txt");
    await fs.writeFile(params2, `%no-protection
Key-Type: RSA
Key-Length: 2048
Name-Real: Emergencia
Name-Email: ${second}
Expire-Date: 0
%commit
`);
    execFileSync("gpg", ["--batch", "--homedir", await gpgPath("gpg", gpgHome), "--generate-key", await gpgPath("gpg", params2)], { stdio: "pipe" });
    const out = path.join(tmp, "dbmulti");
    process.env.FAKE_LOG = path.join(tmp, "fake-logm.json");
    const { manifest } = await runDbBackup({ checkSourceRole: false, databaseUrl: "postgresql://u:p@h/db", outDir: out, recipient: `${recipient}, ${second}`, gpgHome, pgDumpCmd: [process.execPath, fakePgDump], pgRestoreCmd: [process.execPath, fakePgRestore], now: new Date("2026-10-27T08:00:00Z") });
    const packets = execFileSync("gpg", ["--batch", "--homedir", await gpgPath("gpg", gpgHome), "--list-packets", await gpgPath("gpg", path.join(out, manifest.file))], { stdio: ["ignore", "pipe", "pipe"] }).toString();
    expect((packets.match(/pubkey enc packet/g) ?? []).length).toBe(2);
  }, 90000);

  it("BACKUP_EXCLUDE_DATA vira --exclude-table-data no pg_dump (e nada mais muda)", async () => {
    const out = path.join(tmp, "dbx");
    process.env.FAKE_LOG = path.join(tmp, "fake-logx.json");
    await runDbBackup({ checkSourceRole: false, databaseUrl: "postgresql://u:p@h/db", outDir: out, recipient, gpgHome, pgDumpCmd: [process.execPath, fakePgDump], pgRestoreCmd: [process.execPath, fakePgRestore], excludeTableData: ["auth.sessions", "auth.refresh_tokens"], now: new Date("2026-10-27T06:00:00Z") });
    const argv = JSON.parse(await fs.readFile(process.env.FAKE_LOG, "utf8")).argv;
    expect(argv.filter((a, i) => argv[i - 1] === "--exclude-table-data")).toEqual(["auth.sessions", "auth.refresh_tokens"]);
    expect(argv).toContain("--format=custom");
    expect(argv).not.toContain("--no-privileges"); // os GRANTs ficam no backup
  }, 60000);

  it("origem com privilégio mínimo: a sonda roda em sessão somente leitura e o backup segue; o manifesto registra o aceite", async () => {
    const out = path.join(tmp, "db-role-ok");
    process.env.FAKE_LOG = path.join(tmp, "fake-log-role.json");
    process.env.FAKE_PSQL_LOG = path.join(tmp, "psql-log.json");
    process.env.FAKE_ROLE_LINE = "backup_ro|f|f|f|f|t|on|0|0";
    const { manifest } = await runDbBackup({
      checkSourceRole: true, databaseUrl: "postgresql://backup_ro:SENHA@db.exemplo.supabase.co:5432/postgres", outDir: out, recipient, gpgHome,
      pgDumpCmd: [process.execPath, fakePgDump], pgRestoreCmd: [process.execPath, fakePgRestore], psqlCmd: [process.execPath, fakePsql], now: new Date("2026-10-27T05:00:00Z"),
    });
    expect(manifest.details.sourceRole).toEqual({ checked: true, leastPrivilege: true, exceptionAccepted: false });
    const probe = JSON.parse(await fs.readFile(process.env.FAKE_PSQL_LOG, "utf8"));
    expect(probe.pgoptions).toContain("default_transaction_read_only=on");
    expect(probe.argv.join(" ")).toContain("schemas=public,auth,storage");
    expect(probe.argv.join(" ")).not.toContain("SENHA");
  });

  it("origem privilegiada (ex.: postgres com escrita) é RECUSADA antes do pg_dump; só passa com o aceite expresso do dono", async () => {
    const out = path.join(tmp, "db-role-bad");
    process.env.FAKE_LOG = path.join(tmp, "fake-log-role2.json");
    process.env.FAKE_PSQL_LOG = path.join(tmp, "psql-log2.json");
    process.env.FAKE_ROLE_LINE = "postgres|f|t|t|f|t|on|42|3";
    const base = { checkSourceRole: true, databaseUrl: "postgresql://postgres:SENHA@db.exemplo.supabase.co:5432/postgres", outDir: out, recipient, gpgHome, pgDumpCmd: [process.execPath, fakePgDump], pgRestoreCmd: [process.execPath, fakePgRestore], psqlCmd: [process.execPath, fakePsql] };
    await expect(runDbBackup({ ...base, now: new Date("2026-10-27T05:10:00Z") })).rejects.toThrow(/pode gravar em 42 tabela/);
    await expect(fs.access(process.env.FAKE_LOG)).rejects.toThrow(); // o pg_dump nem chegou a rodar
    expect(await fs.readdir(out)).toEqual([]);
    const { manifest } = await runDbBackup({ ...base, acceptPrivilegedSource: true, now: new Date("2026-10-27T05:20:00Z") });
    expect(manifest.details.sourceRole).toEqual({ checked: true, leastPrivilege: false, exceptionAccepted: true });
  });

  it("adulterar o arquivo é detectado pela verificação de integridade", async () => {
    const out = path.join(tmp, "db2");
    process.env.FAKE_LOG = path.join(tmp, "fake-log2.json");
    const { manifest } = await runDbBackup({ checkSourceRole: false,
      databaseUrl: "postgresql://u:p@h/db", outDir: out, recipient, gpgHome, pgDumpCmd: [process.execPath, fakePgDump], pgRestoreCmd: [process.execPath, fakePgRestore], now: new Date("2026-10-27T04:00:00Z"),
    });
    const file = path.join(out, manifest.file);
    const bytes = await fs.readFile(file);
    bytes[bytes.length - 3] ^= 0xff;
    await fs.writeFile(file, bytes);
    const integrity = await verifyIntegrity(out, `${file}.manifest.json`);
    expect(integrity.ok).toBe(false);
    await fs.rm(file);
    expect((await verifyIntegrity(out, `${file}.manifest.json`)).reason).toMatch(/ausente/);
  }, 60000);

  it("falha do pg_dump não deixa arquivo criptografado nem texto claro para trás", async () => {
    const out = path.join(tmp, "db3");
    const bad = path.join(tmp, "bad-pg-dump.mjs");
    await fs.writeFile(bad, `process.stderr.write("erro: password=NAOVAZAR"); process.exit(3);`);
    await expect(
      runDbBackup({ checkSourceRole: false, databaseUrl: "postgresql://u:p@h/db", outDir: out, recipient, gpgHome, pgDumpCmd: [process.execPath, bad], pgRestoreCmd: [process.execPath, fakePgRestore] })
    ).rejects.toThrow(/falhou/);
    const err = await runDbBackup({ checkSourceRole: false, databaseUrl: "postgresql://u:p@h/db", outDir: out, recipient, gpgHome, pgDumpCmd: [process.execPath, bad], pgRestoreCmd: [process.execPath, fakePgRestore] }).catch((e) => e);
    expect(String(err.message)).not.toContain("NAOVAZAR");
    expect((await fs.readdir(out)).filter((f) => !f.endsWith(".json"))).toEqual([]);
  }, 60000);

  it("backup do Storage: lista pastas, ignora nome perigoso, criptografa e restaura com a chave", async () => {
    const objects = {
      "loja-a/logo.webp": "LOGO-A",
      "loja-a/produtos/p1.webp": "FOTO-1",
      "loja-b/capa.webp": "CAPA-B",
      "../fora.txt": "NAO-DEVE-SAIR",
    };
    const folders = (prefix) => {
      const names = Object.keys(objects).filter((n) => (prefix ? n.startsWith(`${prefix}/`) : true));
      const seen = new Map();
      for (const n of names) {
        const rest = prefix ? n.slice(prefix.length + 1) : n;
        const [first, ...tail] = rest.split("/");
        seen.set(first, { name: first, id: tail.length ? null : `id-${n}` });
      }
      return [...seen.values()];
    };
    let authSeen = "";
    const fetchImpl = async (url, init) => {
      authSeen = init?.headers?.Authorization ?? authSeen;
      if (url.includes("/object/list/")) {
        const { prefix } = JSON.parse(init.body);
        return new Response(JSON.stringify(folders(prefix)), { status: 200 });
      }
      const name = decodeURIComponent(url.split("/object/authenticated/restaurant-assets/")[1]).split("/").map((p) => p).join("/");
      return objects[name] === undefined ? new Response("x", { status: 404 }) : new Response(objects[name], { status: 200 });
    };

    expect(await listAllObjects({ baseUrl: "https://x.supabase.co", key: "k", bucket: "restaurant-assets", fetchImpl: fetchImpl })).toEqual(
      ["../fora.txt", "loja-a/logo.webp", "loja-a/produtos/p1.webp", "loja-b/capa.webp"].sort()
    );

    const out = path.join(tmp, "storage");
    const result = await runStorageBackup({
      baseUrl: "https://x.supabase.co", key: "CHAVE-DE-SERVIDOR", outDir: out, recipient, gpgHome, fetchImpl: fetchImpl,
      now: new Date("2026-10-27T05:00:00Z"),
    });
    expect(authSeen).toBe("Bearer CHAVE-DE-SERVIDOR");
    expect(result.files.map((f) => f.name)).toEqual(["loja-a/logo.webp", "loja-a/produtos/p1.webp", "loja-b/capa.webp"]);
    expect(result.skipped).toEqual(["../fora.txt"]);
    expect((await fs.readdir(out)).some((f) => f.startsWith(".staging") || f.endsWith(".tar.gz"))).toBe(false);
    expect(JSON.stringify(result.manifest)).not.toContain("CHAVE-DE-SERVIDOR");

    const restored = await verifyRestorable(out, result.manifest, { gpgHome });
    expect(restored).toMatchObject({ ok: true, files: 3 });
  }, 90000);

  it("restore-storage: reenvia ao Storage de TESTE, confere lista e SHA-256, e detecta destino que grava errado", async () => {
    const source = { "loja-a/logo.webp": "LOGO-A", "loja-a/produtos/p1.webp": "FOTO-1", "loja-b/capa.png": "CAPA-B" };
    const mkApi = (corrupt) => {
      const store = new Map();
      const list = (prefix) => {
        const seen = new Map();
        for (const n of store.keys()) {
          if (prefix && !n.startsWith(`${prefix}/`)) continue;
          const rest = prefix ? n.slice(prefix.length + 1) : n;
          const [first, ...tail] = rest.split("/");
          seen.set(first, { name: first, id: tail.length ? null : "id" });
        }
        return [...seen.values()];
      };
      const fetchImpl = async (url, init) => {
        if (url.includes("/object/list/")) return new Response(JSON.stringify(list(JSON.parse(init.body).prefix)), { status: 200 });
        if (url.includes("/object/authenticated/")) {
          const n = decodeURIComponent(url.split("/object/authenticated/restaurant-assets/")[1]);
          return store.has(n) ? new Response(store.get(n), { status: 200 }) : new Response("x", { status: 404 });
        }
        const n = decodeURIComponent(url.split("/storage/v1/object/restaurant-assets/")[1]);
        if (init.method === "POST") {
          if (store.has(n) && init.headers["x-upsert"] !== "true") return new Response("Duplicate", { status: 409 });
          store.set(n, corrupt ? Buffer.from("CORROMPIDO") : Buffer.from(init.body));
          return new Response("{}", { status: 200 });
        }
        return new Response("x", { status: 404 });
      };
      // origem para o backup (lista/baixa) e destino para a restauração
      const src = new Map(Object.entries(source).map(([k, v]) => [k, Buffer.from(v)]));
      return { store, fetchImpl, src };
    };
    const { src } = mkApi(false);
    const srcFetch = async (url, init) => {
      if (url.includes("/object/list/")) {
        const prefix = JSON.parse(init.body).prefix;
        const seen = new Map();
        for (const n of src.keys()) {
          if (prefix && !n.startsWith(`${prefix}/`)) continue;
          const rest = prefix ? n.slice(prefix.length + 1) : n;
          const [first, ...tail] = rest.split("/");
          seen.set(first, { name: first, id: tail.length ? null : "id" });
        }
        return new Response(JSON.stringify([...seen.values()]), { status: 200 });
      }
      const n = decodeURIComponent(url.split("/object/authenticated/restaurant-assets/")[1]);
      return src.has(n) ? new Response(src.get(n), { status: 200 }) : new Response("x", { status: 404 });
    };
    const out = path.join(tmp, "storage-restore");
    const backup = await runStorageBackup({ baseUrl: "https://x.supabase.co", key: "k", outDir: out, recipient, gpgHome, fetchImpl: srcFetch, now: new Date("2026-10-27T07:00:00Z") });

    const good = mkApi(false);
    const ok = await runStorageRestore({ dir: out, manifest: backup.manifest, baseUrl: "http://127.0.0.1:1", key: "k", gpgHome, fetchImpl: good.fetchImpl });
    expect(ok).toMatchObject({ ok: true, expected: 3, uploaded: 3, verified: 3, missing: [] });
    expect([...good.store.keys()].sort()).toEqual(Object.keys(source).sort());

    // reenviar por cima sem --upsert: o destino recusa duplicado e o resultado NÃO é aprovado
    const dup = await runStorageRestore({ dir: out, manifest: backup.manifest, baseUrl: "http://127.0.0.1:1", key: "k", gpgHome, fetchImpl: good.fetchImpl });
    expect(dup.ok).toBe(false);
    expect(dup.problems.join(" ")).toMatch(/409/);

    // destino que grava conteúdo errado: o SHA-256 de conferência acusa
    const bad = mkApi(true);
    const wrong = await runStorageRestore({ dir: out, manifest: backup.manifest, baseUrl: "http://127.0.0.1:1", key: "k", gpgHome, fetchImpl: bad.fetchImpl });
    expect(wrong.ok).toBe(false);
    expect(wrong.problems.join(" ")).toMatch(/SHA-256 diferente/);
  }, 90000);

  it("restore-storage recusa destino de produção ou não confirmado ANTES de decifrar", async () => {
    expect(assertStorageTarget("http://127.0.0.1:54321")).toEqual({ local: true });
    expect(() => assertStorageTarget("https://abcdefghijklmnopqrst.supabase.co")).toThrow(/allow-remote-ref/);
    expect(() => assertStorageTarget("https://abcdefghijklmnopqrst.supabase.co", { allowRemoteRef: "outroprojetooutroprojet" })).toThrow(/allow-remote-ref/);
    expect(assertStorageTarget("https://abcdefghijklmnopqrst.supabase.co", { allowRemoteRef: "abcdefghijklmnopqrst" })).toMatchObject({ local: false });
    expect(() => assertStorageTarget("https://abcdefghijklmnopqrst.supabase.co", { allowRemoteRef: "abcdefghijklmnopqrst", protectedRefs: ["abcdefghijklmnopqrst"] })).toThrow(/protegidos|PROTECTED/i);
    expect(() => assertStorageTarget("https://exemplo.com")).toThrow(/Recusado/);
    const out = path.join(tmp, "storage");
    const m = JSON.parse(await fs.readFile(path.join(out, (await fs.readdir(out)).find((f) => f.endsWith(".manifest.json"))), "utf8"));
    await expect(runStorageRestore({ dir: out, manifest: m, baseUrl: "https://abcdefghijklmnopqrst.supabase.co", key: "k", gpgHome, protectedRefs: ["abcdefghijklmnopqrst"], allowRemoteRef: "abcdefghijklmnopqrst" })).rejects.toThrow(/Recusado/);
  });

  it("restauração recusa destino remoto ANTES de decifrar qualquer coisa", async () => {
    const out = path.join(tmp, "db");
    const mfile = (await fs.readdir(out)).find((f) => f.endsWith(".manifest.json"));
    const manifest = JSON.parse(await fs.readFile(path.join(out, mfile), "utf8"));
    await expect(verifyRestorable(out, manifest, { gpgHome, restoreUrl: "postgres://u:p@db.exemplo.supabase.co/postgres" })).rejects.toThrow(/Recusado/);
  });

  it("retenção em disco remove arquivo e manifesto juntos", async () => {
    const dir = path.join(tmp, "ret");
    await fs.mkdir(dir);
    const mk = async (iso) => {
      const n = `menunext-db-${backupStamp(new Date(iso))}.dump.gpg`;
      await fs.writeFile(path.join(dir, n), "x");
      await fs.writeFile(path.join(dir, `${n}.manifest.json`), "{}");
      return n;
    };
    const old1 = await mk("2026-01-05T03:00:00Z");
    const old2 = await mk("2026-01-05T09:00:00Z");
    const fresh = await mk("2026-10-27T03:00:00Z");
    const { remove } = await pruneDir(dir, "menunext-db", new Date("2026-10-27T12:00:00Z"), { daily: 7, weekly: 4, monthly: 2 });
    expect(remove).toEqual(expect.arrayContaining([old1, old2]));
    const left = await fs.readdir(dir);
    expect(left).toContain(fresh);
    expect(left).not.toContain(old1);
    expect(left).not.toContain(`${old1}.manifest.json`);
  });

  it("frescor: acusa backup parado e aceita backup recente", async () => {
    const dir = path.join(tmp, "db");
    expect((await checkFreshness(dir, "db", 26, new Date("2026-10-27T10:00:00Z"))).ok).toBe(true);
    const stale = await checkFreshness(dir, "db", 26, new Date("2026-10-30T10:00:00Z"));
    expect(stale.ok).toBe(false);
    expect((await checkFreshness(path.join(tmp, "vazia"), "db", 26)).ok).toBe(false);
  });
});

describe("o que nunca vai para o Git", () => {
  it("gitignore protege backups e chaves", async () => {
    const ignore = await fs.readFile(new URL("../../.gitignore", import.meta.url), "utf8");
    for (const line of ["/backups/", "*.gpg", "*.dump", "*.asc", ".gnupg/", "docs/auditoria/", ".env*"]) {
      expect(ignore.split(/\r?\n/), line).toContain(line);
    }
  });

  it("nenhum arquivo rastreado parece chave, backup ou segredo", () => {
    const tracked = execFileSync("git", ["ls-files"], { cwd: new URL("../..", import.meta.url), encoding: "utf8" }).split("\n").filter(Boolean);
    const bad = tracked.filter((f) => /\.(gpg|dump|asc|pem|key)$/i.test(f) || /(^|\/)\.env(\.|$)/.test(f) && f !== ".env.example" || f.startsWith("docs/auditoria/"));
    expect(bad).toEqual([]);
  });
});

describe("portão de autorização do primeiro backup real", () => {
  const ok = { id: 1, label: "x", status: "OK" };

  it("só libera com TODOS os itens OK; FALHA e NAO_VERIFICADO bloqueiam", () => {
    expect(evaluateGate([ok, { ...ok, id: 2 }]).pass).toBe(true);
    expect(evaluateGate([ok, { ...ok, id: 2, status: "FALHA" }])).toEqual({ pass: false, blocked: ["2 FALHA"] });
    expect(evaluateGate([{ ...ok, status: "NAO_VERIFICADO" }]).pass).toBe(false);
  });

  it("a confirmação exige a frase com a data de hoje (não vale a de ontem)", () => {
    const day = new Date("2026-10-28T12:00:00Z");
    expect(expectedConfirmation(day)).toBe("EXPORTAR PRODUCAO 2026-10-28");
    expect(checkConfirmation("EXPORTAR PRODUCAO 2026-10-28", day).status).toBe("OK");
    expect(checkConfirmation("EXPORTAR PRODUCAO 2026-10-27", day).status).toBe("FALHA");
    expect(checkConfirmation(undefined, day).status).toBe("FALHA");
  });

  it("espaço: exige no mínimo 5 GB ou 20x o tamanho estimado", () => {
    expect(checkSpace(286 * 1024 ** 3).status).toBe("OK");
    expect(checkSpace(1 * 1024 ** 3).status).toBe("FALHA");
    expect(checkSpace(10 * 1024 ** 3, 1024 ** 3).status).toBe("FALHA");
  });

  it("credenciais: confere só a FORMA e nunca devolve valores", () => {
    const good = { DATABASE_URL: "postgresql://backup_ro:SEGREDO@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?sslmode=require", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "SEGREDO2" };
    const r = checkCredentials(good);
    expect(r.status).toBe("OK");
    expect(JSON.stringify(r)).not.toContain("SEGREDO");
    expect(checkCredentials({}).status).toBe("FALHA");
    expect(checkCredentials({ ...good, DATABASE_URL: good.DATABASE_URL.replace(":5432", ":6543") }).detail).toMatch(/6543/);
    expect(checkCredentials({ ...good, DATABASE_URL: good.DATABASE_URL.replace("?sslmode=require", "") }).detail).toMatch(/sslmode/);
    expect(checkCredentials({ ...good, DATABASE_URL: "postgresql://postgres:x@evil.example.com:5432/postgres?sslmode=require" }).detail).toMatch(/não é Supabase/);
  });

  it("credenciais: o papel postgres é recusado (privilégio demais) salvo aceite expresso; backup_ro vale também no pooler", () => {
    const base = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" };
    const pg = { ...base, DATABASE_URL: "postgresql://postgres:s@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?sslmode=require" };
    expect(checkCredentials(pg).status).toBe("FALHA");
    expect(checkCredentials(pg).detail).toMatch(/backup_ro/);
    const accepted = checkCredentials({ ...pg, BACKUP_ACCEPT_PRIVILEGED_SOURCE: "sim-aceito-pelo-dono" });
    expect(accepted.status).toBe("OK");
    expect(accepted.detail).toMatch(/EXCEÇÃO/);
    expect(checkCredentials({ ...pg, BACKUP_ACCEPT_PRIVILEGED_SOURCE: "sim" }).status).toBe("FALHA");
    const pooler = { ...base, DATABASE_URL: "postgresql://backup_ro.abcdefghijklmnopqrst:s@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require" };
    expect(checkCredentials(pooler).status).toBe("OK");
    expect(checkCredentials({ ...base, DATABASE_URL: pg.DATABASE_URL.replace("postgres:s", "admin:s") }).detail).toMatch(/inesperado/);
  });

  it("modo sem Docker: a confirmação também exige o reconhecimento do que não foi verificado", () => {
    const day = new Date("2026-10-28T12:00:00Z");
    const phrase = "EXPORTAR PRODUCAO 2026-10-28";
    expect(checkConfirmation(phrase, day, { semDocker: true }).status).toBe("FALHA");
    expect(checkConfirmation(phrase, day, { semDocker: true }).detail).toMatch(/aceito-nao-verificados/);
    expect(checkConfirmation(phrase, day, { semDocker: true, acceptUnverified: true }).status).toBe("OK");
    expect(checkConfirmation("errada", day, { semDocker: true, acceptUnverified: true }).status).toBe("FALHA");
    expect(checkConfirmation(phrase, day).status).toBe("OK"); // modo normal inalterado
    expect(UNVERIFIABLE_WITHOUT_DOCKER.join(" ")).toMatch(/Auth.*Storage.*Realtime/s);
  });

  it("chaves GPG: duas chaves iguais não contam; a impressão vem da primeira linha fpr", () => {
    const out = ["tru::1:1:1:0:3:1:5", "pub:u:3072:1:AAAA:1:::u:::scESC:::::::", "fpr:::::::::1111111111111111111111111111111111111111:", "sub:u:3072:1:BBBB:1:::::e::::::", "fpr:::::::::2222222222222222222222222222222222222222:", ""].join("\n");
    expect(primaryFingerprint(out)).toBe("1111111111111111111111111111111111111111");
    expect(primaryFingerprint("")).toBeNull();
    expect(distinctRecipients(["A", "B"])).toBe(true);
    expect(distinctRecipients(["A", "A"])).toBe(false);
    expect(distinctRecipients(["A", null])).toBe(false);
    expect(distinctRecipients([])).toBe(false);
  });

  it("isolamento sem Docker: só loopback conta; 0.0.0.0, :: e IP de rede reprovam", () => {
    expect(evaluateListeners(["127.0.0.1"]).ok).toBe(true);
    expect(evaluateListeners(["::1", "127.0.0.1"]).ok).toBe(true);
    expect(evaluateListeners(["0.0.0.0"]).ok).toBe(false);
    expect(evaluateListeners(["::"]).ok).toBe(false);
    expect(evaluateListeners(["127.0.0.1", "192.168.0.10"]).reason).toMatch(/192\.168/);
    expect(evaluateListeners([]).ok).toBe(false);
  });

  it("revisão estática: os scripts reais da origem não têm escrita e forçam sessão somente leitura", async () => {
    const dir = new URL(".", import.meta.url);
    const read = (f) => fs.readFile(new URL(f, dir), "utf8");
    const files = { "backup-db.mjs": await read("backup-db.mjs"), "backup-storage.mjs": await read("backup-storage.mjs"), "fingerprint.sql": await read("fingerprint.sql"), "source-role-probe.sql": await read("source-role-probe.sql") };
    expect(checkReadOnlySource(files).status).toBe("OK");
    expect(checkReadOnlySource({ ...files, "source-role-probe.sql": files["source-role-probe.sql"] + "\ntruncate table public.orders;" }).status).toBe("FALHA");
    expect(checkReadOnlySource({ ...files, "backup-db.mjs": files["backup-db.mjs"].replaceAll("probeSourceRole(", "naoConfere(") }).status).toBe("FALHA");
    // e detecta se alguém introduzir escrita
    expect(checkReadOnlySource({ ...files, "backup-storage.mjs": files["backup-storage.mjs"] + '\nfetch(u, { method: "DELETE" })' }).status).toBe("FALHA");
    expect(checkReadOnlySource({ ...files, "backup-db.mjs": files["backup-db.mjs"] + '\nconst q = "delete from orders";' }).status).toBe("FALHA");
    expect(checkReadOnlySource({ ...files, "backup-db.mjs": files["backup-db.mjs"].replace("default_transaction_read_only=on", "x") }).status).toBe("FALHA");
  });
});

describe("cópias para disco externo e R2 (arquivos já cifrados; nada é decifrado)", () => {
  let base;
  beforeAll(async () => { base = await fs.mkdtemp(path.join(os.tmpdir(), "menunext-sync-test-")); });
  afterAll(async () => { await fs.rm(base, { recursive: true, force: true }); });

  async function makeBackup(dir, iso, content = "conteudo-cifrado-falso", kind = "db") {
    const stamp = backupStamp(new Date(iso));
    const name = kind === "db" ? `menunext-db-${stamp}.dump.gpg` : `menunext-storage-${stamp}.tar.gz.gpg`;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), content);
    const manifest = buildManifest({ kind, file: name, bytes: Buffer.byteLength(content), sha256: await sha256File(path.join(dir, name)), createdAt: new Date(iso) });
    await writeManifest(dir, manifest);
    return { name, manifest };
  }

  it("disco externo: copia arquivo e manifesto, confere o hash e não repete o que já está lá", async () => {
    const src = path.join(base, "e1-src"), dest = path.join(base, "e1-dest");
    await fs.mkdir(dest, { recursive: true });
    const { name } = await makeBackup(src, "2026-10-28T03:00:00Z");
    await fs.writeFile(path.join(src, "anotacoes-pessoais.txt"), "nao e backup"); // arquivo estranho nunca é copiado
    const first = await syncExternal({ srcDir: src, destDir: dest, allowSameVolume: true, now: new Date("2026-10-28T10:00:00Z") });
    expect(first.copied).toEqual([name]);
    expect((await fs.readdir(dest)).sort()).toEqual([name, `${name}.manifest.json`]);
    const second = await syncExternal({ srcDir: src, destDir: dest, allowSameVolume: true, now: new Date("2026-10-28T10:00:00Z") });
    expect(second.copied).toEqual([]);
    expect(second.skipped).toEqual([name]);
  });

  it("disco externo: origem adulterada, destino divergente e disco desconectado são recusados sem sobrescrever nada", async () => {
    const src = path.join(base, "e2-src"), dest = path.join(base, "e2-dest");
    await fs.mkdir(dest, { recursive: true });
    const { name } = await makeBackup(src, "2026-10-28T04:00:00Z");
    await fs.writeFile(path.join(src, name), "ADULTERADO");
    const bad = await syncExternal({ srcDir: src, destDir: dest, allowSameVolume: true });
    expect(bad.failed[0].reason).toMatch(/origem não confere/);
    expect(await fs.readdir(dest)).toEqual([]);

    const ok = await makeBackup(path.join(base, "e2b-src"), "2026-10-28T05:00:00Z");
    await fs.writeFile(path.join(dest, ok.name), "OUTRO CONTEUDO JA NO DESTINO");
    const conflict = await syncExternal({ srcDir: path.join(base, "e2b-src"), destDir: dest, allowSameVolume: true });
    expect(conflict.failed[0].reason).toMatch(/conflito/);
    expect(await fs.readFile(path.join(dest, ok.name), "utf8")).toBe("OUTRO CONTEUDO JA NO DESTINO");

    await expect(syncExternal({ srcDir: src, destDir: path.join(base, "nao-conectado"), allowSameVolume: true })).rejects.toThrow(/não está conectado/);
    await expect(fs.access(path.join(base, "nao-conectado"))).rejects.toThrow(); // a pasta não foi criada
  });

  it("disco externo: recusa o mesmo volume e a pasta do repositório; --dry-run não grava nada", async () => {
    const src = path.join(base, "e3-src"), dest = path.join(base, "e3-dest");
    await fs.mkdir(dest, { recursive: true });
    await makeBackup(src, "2026-10-28T06:00:00Z");
    await expect(syncExternal({ srcDir: src, destDir: dest })).rejects.toThrow(/MESMO volume/);
    const repoDest = path.resolve(fileURLToPath(new URL("../../backups-teste-nao-existe", import.meta.url)));
    await fs.mkdir(repoDest, { recursive: true });
    try { await expect(syncExternal({ srcDir: src, destDir: repoDest, allowSameVolume: true })).rejects.toThrow(/dentro do repositório/); }
    finally { await fs.rm(repoDest, { recursive: true, force: true }); }
    const dry = await syncExternal({ srcDir: src, destDir: dest, allowSameVolume: true, dryRun: true });
    expect(dry.copied).toHaveLength(1);
    expect(await fs.readdir(dest)).toEqual([]);
  });

  it("disco externo: aplica a retenção no destino", async () => {
    const src = path.join(base, "e4-src"), dest = path.join(base, "e4-dest");
    await fs.mkdir(dest, { recursive: true });
    const old = await makeBackup(dest, "2026-01-05T03:00:00Z");
    const older = await makeBackup(dest, "2026-01-05T09:00:00Z");
    await makeBackup(src, "2026-10-28T03:00:00Z");
    const r = await syncExternal({ srcDir: src, destDir: dest, allowSameVolume: true, now: new Date("2026-10-28T12:00:00Z"), retention: { daily: 7, weekly: 4, monthly: 2 } });
    expect([...r.pruned].sort()).toEqual([old.name, older.name].sort()); // janeiro está fora da janela da política: os dois saem
    expect((await fs.readdir(dest)).filter((n) => n.endsWith(".gpg")).length).toBe(1); // só o backup novo fica
  });

  it("R2: a configuração incompleta ou estranha é recusada", () => {
    expect(missingR2Env({})).toHaveLength(5);
    const ok = { RCLONE_CONFIG_R2_TYPE: "s3", RCLONE_CONFIG_R2_ACCESS_KEY_ID: "a", RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: "b", RCLONE_CONFIG_R2_ENDPOINT: "https://abc123.r2.cloudflarestorage.com", R2_BUCKET: "menunext-backups" };
    expect(missingR2Env(ok)).toEqual([]);
    expect(missingR2Env({ ...ok, RCLONE_CONFIG_R2_ENDPOINT: "https://evil.example.com" })[0]).toMatch(/não parece/);
    expect(missingR2Env({ ...ok, RCLONE_CONFIG_R2_TYPE: "sftp" })[0]).toMatch(/s3/);
  });

  it("R2: sem --executar só planeja; com rclone simulado envia o arquivo e depois o manifesto, com --immutable e sem segredo em argumento", async () => {
    const src = path.join(base, "r1-src");
    const { name } = await makeBackup(src, "2026-10-28T03:00:00Z", "cifrado-r2");
    await makeBackup(src, "2026-10-28T04:00:00Z", "cifrado-storage", "storage");
    await fs.writeFile(path.join(src, "chave-privada.asc"), "NUNCA SAI"); // fora do padrão: nunca é enviado
    const log = path.join(base, "rclone-log.jsonl");
    const fake = path.join(base, "fake-rclone.mjs");
    await fs.writeFile(fake, `import fs from "node:fs";
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + "\\n");
if (a[0] === "lsjson") console.log(JSON.stringify([{ Name: "x", Size: Number(process.env.FAKE_REMOTE_SIZE) }]));
`);
    const dry = await syncR2({ srcDir: src, bucket: "menunext-backups", rcloneCmd: [process.execPath, fake] });
    expect(dry.executed).toBe(false);
    expect(dry.plan).toHaveLength(2);
    await expect(fs.access(log)).rejects.toThrow(); // simulação: o rclone nem foi chamado

    process.env.FAKE_REMOTE_SIZE = String(Buffer.byteLength("cifrado-r2"));
    const done = await syncR2({ srcDir: src, bucket: "menunext-backups", rcloneCmd: [process.execPath, fake], execute: true });
    const calls = (await fs.readFile(log, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    const dbCalls = calls.filter((c) => c.join(" ").includes(name));
    expect(dbCalls.map((c) => c[0])).toEqual(["copyto", "lsjson", "copyto"]);
    expect(dbCalls[0]).toContain("--immutable");
    expect(dbCalls[2].join(" ")).toContain(".manifest.json"); // manifesto por último
    expect(calls.flat().join(" ")).not.toContain("chave-privada");
    expect(calls.flat().join(" ")).not.toMatch(/SECRET|ACCESS_KEY/i);
    expect(done.sent).toContain(name);
    expect(done.failed.some((f) => /tamanho remoto/.test(f.reason))).toBe(true); // o de Storage tem outro tamanho -> detectado
    delete process.env.FAKE_REMOTE_SIZE;
  });
});
