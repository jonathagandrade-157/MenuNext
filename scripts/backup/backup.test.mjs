import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertDisposableTarget, backupStamp, checkFreshness, gpgPath, heartbeat, parseStamp, pgEnvFromUrl, pruneDir, redact, selectRetention,
} from "./lib.mjs";
import { runDbBackup } from "./backup-db.mjs";
import { listAllObjects, runStorageBackup, safeObjectPath } from "./backup-storage.mjs";
import { verifyIntegrity, verifyRestorable } from "./verify-backup.mjs";
import { assertStorageTarget, runStorageRestore } from "./restore-storage.mjs";

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
    const { manifest } = await runDbBackup({
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

  it("BACKUP_EXCLUDE_DATA vira --exclude-table-data no pg_dump (e nada mais muda)", async () => {
    const out = path.join(tmp, "dbx");
    process.env.FAKE_LOG = path.join(tmp, "fake-logx.json");
    await runDbBackup({ databaseUrl: "postgresql://u:p@h/db", outDir: out, recipient, gpgHome, pgDumpCmd: [process.execPath, fakePgDump], pgRestoreCmd: [process.execPath, fakePgRestore], excludeTableData: ["auth.sessions", "auth.refresh_tokens"], now: new Date("2026-10-27T06:00:00Z") });
    const argv = JSON.parse(await fs.readFile(process.env.FAKE_LOG, "utf8")).argv;
    expect(argv.filter((a, i) => argv[i - 1] === "--exclude-table-data")).toEqual(["auth.sessions", "auth.refresh_tokens"]);
    expect(argv).toContain("--format=custom");
    expect(argv).not.toContain("--no-privileges"); // os GRANTs ficam no backup
  }, 60000);

  it("adulterar o arquivo é detectado pela verificação de integridade", async () => {
    const out = path.join(tmp, "db2");
    process.env.FAKE_LOG = path.join(tmp, "fake-log2.json");
    const { manifest } = await runDbBackup({
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
      runDbBackup({ databaseUrl: "postgresql://u:p@h/db", outDir: out, recipient, gpgHome, pgDumpCmd: [process.execPath, bad], pgRestoreCmd: [process.execPath, fakePgRestore] })
    ).rejects.toThrow(/falhou/);
    const err = await runDbBackup({ databaseUrl: "postgresql://u:p@h/db", outDir: out, recipient, gpgHome, pgDumpCmd: [process.execPath, bad], pgRestoreCmd: [process.execPath, fakePgRestore] }).catch((e) => e);
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
