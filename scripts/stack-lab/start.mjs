// LABORATÓRIO SINTÉTICO de ponta a ponta (NÃO é homologação no Supabase): PostgreSQL descartável + PostgREST (a
// mesma API que o Supabase usa em /rest/v1) + um gateway mínimo que imita /rest/v1 e /auth/v1/user. Serve para
// rodar o aplicativo de verdade (build de produção) e o navegador contra todas as migrations, com dados FALSOS.
// Nada aqui fala com o Supabase, com a Vercel ou com dados reais. Sem Docker.
//
// Uso (rodar como usuário sem privilégios; o PostgreSQL recusa root):
//   POSTGREST_BIN=/caminho/postgrest PG_BIN=/usr/lib/postgresql/16/bin node scripts/stack-lab/start.mjs
// Variáveis opcionais:
//   STACK_EXCLUDE   migrations a NÃO aplicar (nomes separados por vírgula) — simula bancos "antigos"
//   STACK_SEED      arquivo SQL de dados sintéticos (padrão: scripts/stack-lab/seed.sql)
//   STACK_OUT       onde gravar stack.json (chaves sintéticas e cookies de sessão dos usuários de teste)
// Comandos enquanto roda: arquivo SQL em STACK_OUT/apply.sql + `kill -USR2 <pid>` aplica e recarrega o PostgREST.
import { execFileSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const PG = process.env.PG_BIN || "/usr/lib/postgresql/17/bin";
const POSTGREST = process.env.POSTGREST_BIN;
if (!POSTGREST) throw new Error("POSTGREST_BIN obrigatório");
const PG_PORT = 55440, PGRST_PORT = 55441, GW_PORT = 54321;
// Segredo SINTÉTICO, só deste laboratório (não é chave de nenhum ambiente).
const JWT_SECRET = "stack-lab-synthetic-secret-not-a-real-key-000000";
const out = process.env.STACK_OUT || fs.mkdtempSync(path.join(os.tmpdir(), "stack-lab-out-"));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stack-lab-pg-"));
const data = path.join(dir, "pgdata");
const env = { ...process.env, PGHOST: "127.0.0.1", PGPORT: String(PG_PORT), PGUSER: "postgres", PGDATABASE: "postgres", PGOPTIONS: "-c request.jwt.claims={}" };
const run = (bin, args) => execFileSync(path.join(PG, bin), args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const psqlFile = (f) => run("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", f]);
const b64url = (b) => Buffer.from(b).toString("base64url");

export function signJwt(payload) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
function verifyJwt(token) {
  const [h, b, s] = String(token).split(".");
  if (!h || !b || !s) return null;
  const sig = createHmac("sha256", JWT_SECRET).update(`${h}.${b}`).digest("base64url");
  if (sig !== s) return null;
  const p = JSON.parse(Buffer.from(b, "base64url").toString());
  return p.exp && p.exp * 1000 < Date.now() ? null : p;
}

run("initdb", ["-D", data, "--username=postgres", "--auth=trust", "--encoding=UTF8", "--locale=C"]);
run("pg_ctl", ["-D", data, "-l", path.join(dir, "postgres.log"), "-o", `-h 127.0.0.1 -p ${PG_PORT} -c unix_socket_directories='' -c wal_level=logical`, "-w", "start"]);
const children = [];
function stop() {
  for (const c of children) c.kill("SIGTERM");
  try { run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]); } catch {}
}
process.on("SIGTERM", () => { stop(); process.exit(0); });
process.on("SIGINT", () => { stop(); process.exit(0); });

try {
  psqlFile(path.join(root, "scripts/checkout-lab/bootstrap.sql"));
  run("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-c",
    "create role authenticator login noinherit; grant anon, authenticated, service_role to authenticator;"]);
  const exclude = new Set((process.env.STACK_EXCLUDE || "").split(",").map((s) => s.trim()).filter(Boolean));
  const migrations = fs.readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const m of migrations) if (!exclude.has(m)) psqlFile(path.join(root, "supabase/migrations", m));
  psqlFile(process.env.STACK_SEED || path.join(here, "seed.sql"));
} catch (e) {
  console.error("FALHA ao preparar o banco:", String(e.stderr || e.message).slice(0, 2000));
  stop();
  process.exit(1);
}

const conf = path.join(dir, "postgrest.conf");
fs.writeFileSync(conf, [
  `db-uri = "postgres://authenticator@127.0.0.1:${PG_PORT}/postgres"`,
  `db-schemas = "public"`, `db-anon-role = "anon"`, `jwt-secret = "${JWT_SECRET}"`,
  `server-host = "127.0.0.1"`, `server-port = ${PGRST_PORT}`, `db-channel-enabled = true`, `log-level = "warn"`,
].join("\n"));
const pgrst = spawn(POSTGREST, [conf], { stdio: ["ignore", "inherit", "inherit"] });
children.push(pgrst);

// ---- usuários sintéticos (os mesmos ids do seed) e sessões no formato do @supabase/ssr ----
const users = JSON.parse(fs.readFileSync(path.join(here, "users.json"), "utf8"));
const now = Math.floor(Date.now() / 1000);
const anonKey = signJwt({ role: "anon", iss: "stack-lab", iat: 1700000000 });
const serviceKey = signJwt({ role: "service_role", iss: "stack-lab", iat: 1700000000 });
const userObj = (u) => ({
  id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  // termos já aceitos (versão vigente do src/lib/legal.ts) para o painel não parar no aceite
  user_metadata: { name: u.name, terms_version: u.termsVersion, terms_accepted_at: "2026-11-01T00:00:00Z" },
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", factors: [],
});
const sessions = {};
for (const u of users) {
  const exp = now + 6 * 3600;
  const access = signJwt({ sub: u.id, role: "authenticated", aud: "authenticated", email: u.email, aal: "aal1", session_id: `s-${u.id}`, iat: now, exp });
  const session = { access_token: access, refresh_token: `refresh-${u.id}`, token_type: "bearer", expires_in: 6 * 3600, expires_at: exp, user: userObj(u) };
  sessions[u.key] = { cookieName: "sb-127-auth-token", cookieValue: "base64-" + b64url(JSON.stringify(session)), userId: u.id };
}
fs.writeFileSync(path.join(out, "stack.json"), JSON.stringify({ url: `http://127.0.0.1:${GW_PORT}`, anonKey, serviceKey, sessions, pid: process.pid }, null, 2));

// ---- gateway /rest/v1 -> PostgREST, /auth/v1/user -> usuário do JWT ----
const byId = new Map(users.map((u) => [u.id, u]));
http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (url.pathname.startsWith("/auth/v1/")) {
    const claims = verifyJwt(bearer);
    if (url.pathname === "/auth/v1/user" && claims?.sub && byId.has(claims.sub)) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(userObj(byId.get(claims.sub))));
    }
    if (url.pathname === "/auth/v1/logout") { res.writeHead(204); return res.end(); }
    res.writeHead(401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ code: 401, error_code: "bad_jwt", msg: "invalid JWT" }));
  }
  if (!url.pathname.startsWith("/rest/v1")) { res.writeHead(404); return res.end(); }
  const headers = { ...req.headers, host: `127.0.0.1:${PGRST_PORT}` };
  delete headers.apikey;
  const upstream = http.request({ host: "127.0.0.1", port: PGRST_PORT, method: req.method, path: url.pathname.slice("/rest/v1".length) + url.search || "/", headers }, (up) => {
    res.writeHead(up.statusCode, up.headers);
    up.pipe(res);
  });
  upstream.on("error", () => { res.writeHead(502); res.end(); });
  req.pipe(upstream);
}).listen(GW_PORT, "127.0.0.1");

process.on("SIGUSR2", () => {
  const f = path.join(out, "apply.sql");
  try {
    psqlFile(f);
    run("psql", ["-X", "-q", "-c", "notify pgrst, 'reload schema'"]);
    fs.writeFileSync(path.join(out, "apply.result"), "OK\n");
  } catch (e) {
    fs.writeFileSync(path.join(out, "apply.result"), "ERRO " + String(e.stderr || e.message).slice(0, 2000) + "\n");
  }
});
console.log(`stack-lab pronto: gateway http://127.0.0.1:${GW_PORT} | saída ${out}`);
