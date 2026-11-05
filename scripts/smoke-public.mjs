// Smoke HTTP do build, em loopback e com configuracao SINTETICA. Nao testa banco nem pagamentos.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const base = "http://127.0.0.1:3137";
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3137"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "placeholder-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "",
    ASAAS_API_KEY: "", MERCADO_PAGO_ACCESS_TOKEN: "", CRON_SECRET: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
server.stdout.on("data", (data) => { output = (output + data).slice(-8000); });
server.stderr.on("data", (data) => { output = (output + data).slice(-8000); });
const request = (route) => fetch(base + route, { redirect: "manual", signal: AbortSignal.timeout(5000) });

try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (server.exitCode !== null) throw new Error(`Servidor encerrou (${server.exitCode})`);
    try { const response = await request("/"); if (response.ok) { ready = true; break; } } catch { /* inicializando */ }
    await delay(250);
  }
  assert(ready, "Servidor nao ficou pronto");
  const home = await request("/");
  assert.equal(home.status, 200);
  const html = await home.text();
  const visible = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ");
  assert.match(visible, /Pix direto na sua chave/);
  assert.match(visible, /confere o recebimento no seu banco/i);
  assert.doesNotMatch(visible, /Pix Automático|Pix confirmado instantâneo|e-mails para fazer remarketing/i);
  assert.equal(home.headers.get("x-content-type-options"), "nosniff");
  assert.equal(home.headers.get("x-frame-options"), "DENY");
  assert.match(home.headers.get("content-security-policy") || "", /nonce-/);
  console.log("SMOKE /: 200, texto Pix corrigido e cabecalhos de seguranca");

  const registration = await request("/cadastro");
  assert.equal(registration.status, 200);
  assert.match(await registration.text(), /<form/);
  console.log("SMOKE /cadastro: 200, formulario renderizado (sem enviar cadastro)");

  const panel = await request("/painel");
  assert([302, 303, 307, 308].includes(panel.status));
  const redirect = new URL(panel.headers.get("location"), base);
  assert.equal(redirect.pathname, "/cadastro");
  assert.equal(redirect.searchParams.get("mode"), "login");
  assert.equal(redirect.searchParams.get("next"), "/painel");
  console.log("SMOKE /painel: visitante redirecionado ao login");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  // O processo usa somente valores sinteticos; nao imprime ambiente ou cookies.
  console.error(output);
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
}
