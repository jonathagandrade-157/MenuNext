// PostgreSQL nativo DESCARTAVEL na nuvem. Sem Docker, WSL, credenciais ou conexao com Supabase.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const bin = process.env.CHECKOUT_PG_BIN || "/usr/lib/postgresql/17/bin";
const tool = (name) => path.join(bin, name);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "menunext-checkout-synthetic-"));
const data = path.join(dir, "pgdata");
const env = {
  ...process.env,
  PGHOST: "127.0.0.1", PGPORT: "55432", PGUSER: "postgres", PGDATABASE: "postgres",
  PGPASSWORD: "", PGSSLMODE: "disable",
  PGOPTIONS: "-c request.jwt.claims={}",
};
delete env.PGSERVICE;
delete env.PGSERVICEFILE;
delete env.PGPASSFILE;
const run = (name, args) => execFileSync(tool(name), args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const sql = (source) => run("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-c", source]);
const file = (name) => run("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-f", name]);
const migration1 = "20261027010000_checkout_counter_wrapper_and_flood_guard.sql";
const migration2 = "20261027020000_revoke_public_checkout_rpcs.sql";
const signature = "public.create_order(text,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,text,numeric,text,numeric,text)";
let started = false;

function checkStage(stage, hasWrapper, publicAllowed) {
  sql(`do $$ begin
    if (to_regprocedure('public.create_counter_order(text,text,text,text,jsonb,text,numeric,text,text)') is not null) <> ${hasWrapper} then
      raise exception 'counter RPC incompatible';
    end if;
    if has_function_privilege('anon', '${signature}', 'EXECUTE') <> ${publicAllowed}
      or has_function_privilege('authenticated', '${signature}', 'EXECUTE') <> ${publicAllowed}
      or not has_function_privilege('service_role', '${signature}', 'EXECUTE') then
      raise exception 'checkout privileges incompatible';
    end if;
    if ${hasWrapper} and not has_function_privilege('authenticated', to_regprocedure('public.create_counter_order(text,text,text,text,jsonb,text,numeric,text,text)'), 'EXECUTE') then
      raise exception 'counter member access missing';
    end if;
  end $$;`);
  console.log(`ROLLOUT ${stage}: OK (dependencias SQL; nao e deploy do aplicativo)`);
}

try {
  const version = run("postgres", ["--version"]).trim();
  if (!/PostgreSQL\) 17\./.test(version)) throw new Error(`PostgreSQL 17 exigido: ${version}`);
  console.log(version);
  run("initdb", ["-D", data, "--username=postgres", "--auth=trust", "--encoding=UTF8", "--locale=C"]);
  run("pg_ctl", ["-D", data, "-l", path.join(dir, "postgres.log"), "-o", "-h 127.0.0.1 -p 55432 -c unix_socket_directories='' -c wal_level=logical", "-w", "start"]);
  started = true;
  console.log(sql("select version();"));
  file(path.join(here, "bootstrap.sql"));
  const migrations = fs.readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const name of migrations.filter((f) => f !== migration1 && f !== migration2)) {
    file(path.join(root, "supabase/migrations", name));
  }
  // Estagios de privilegios so existem quando as migrations de checkout (1 e 2) estao no repositorio.
  const migrationsDir = path.join(root, "supabase/migrations");
  const has1 = fs.existsSync(path.join(migrationsDir, migration1));
  const has2 = fs.existsSync(path.join(migrationsDir, migration2));
  if (has2 && !has1) throw new Error("migration 2 sem migration 1: ordem de rollout invalida");
  // Baseline: create_order segue executavel por anon/authenticated (comportamento atual de producao).
  checkStage("baseline", false, true);
  let stages = 1;
  if (has1) {
    file(path.join(migrationsDir, migration1));
    checkStage("migration-1", true, true);
    stages += 1;
  }
  if (has2) {
    file(path.join(migrationsDir, migration2));
    checkStage("migration-2", true, false);
    stages += 1;
  }

  // Todas as suites de supabase/tests rodam (isolamento entre lojas, privilegios, storage, cobranca, checkout...).
  let seeded = false;
  const runSuites = (names) => {
    let sum = 0;
    for (const name of names) {
      // tenant_isolation.sql precisa de lojas e usuarios pre-existentes (em producao ja existem); aqui sao sinteticos.
      if (name === "tenant_isolation.sql" && !seeded) {
        file(path.join(here, "seed-tenants.sql"));
        seeded = true;
      }
      const result = spawnSync(tool("psql"), ["-X", "-v", "ON_ERROR_STOP=1", "-f", path.join(root, "supabase/tests", name)], { env, encoding: "utf8" });
      const output = `${result.stdout || ""}\n${result.stderr || ""}`;
      // Estas suites encerram por RAISE EXCEPTION para desfazer TODOS os dados sinteticos.
      const match = /ERROR:\s+RESULTADO: OK \| (\d+) verificacoes/.exec(output);
      if (result.status !== 3 || !match || output.includes("RESULTADO: FALHOU")) {
        throw new Error(`${name}: ${output.slice(-5000)}`);
      }
      sum += Number(match[1]);
      console.log(`${name}: OK | ${match[1]} verificacoes (rollback)`);
    }
    return sum;
  };
  const suites = fs.readdirSync(path.join(root, "supabase/tests")).filter((f) => f.endsWith(".sql")).sort();
  if (suites.length === 0) throw new Error("nenhuma suite SQL encontrada");
  const total = runSuites(suites);
  // Concorrencia real (varias sessoes psql ao mesmo tempo), quando o laboratorio traz esse cenario.
  const concurrencyFile = path.join(here, "concurrency.mjs");
  if (fs.existsSync(concurrencyFile)) {
    const { runConcurrency } = await import(concurrencyFile);
    const parallel = (queries) =>
      Promise.all(
        queries.map(
          (query) =>
            new Promise((resolve, reject) => {
              const child = spawn(tool("psql"), ["-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", query], { env });
              let out = "";
              let err = "";
              child.stdout.on("data", (d) => (out += d));
              child.stderr.on("data", (d) => (err += d));
              child.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`sessao concorrente falhou: ${err.slice(-500)}`))));
            }),
        ),
      );
    for (const line of await runConcurrency({ sql, parallel })) console.log(`CONCORRENCIA: ${line}`);
  }
  // Rollback das migrations novas (quando o repositorio traz supabase/rollback): desfaz, confere residuos e reroda o legado.
  const rollbackFile = path.join(here, "rollback.mjs");
  if (fs.existsSync(rollbackFile) && fs.existsSync(path.join(root, "supabase/rollback"))) {
    const { runRollback } = await import(rollbackFile);
    for (const line of runRollback({ root, sql, file, suites: (names) => runSuites(names.filter((n) => suites.includes(n))) })) console.log(`ROLLBACK: ${line}`);
  }
  console.log(`CHECKOUT SQL: OK | ${total} verificacoes | ${stages} etapa(s) de privilegios`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (error?.stderr) console.error(String(error.stderr).slice(-5000));
  process.exitCode = 1;
} finally {
  if (started) run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
  fs.rmSync(dir, { recursive: true, force: true });
}
