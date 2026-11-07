// Verificação em NAVEGADOR REAL (Chromium via Playwright) do Turnstile com chaves de TESTE oficiais da Cloudflare.
// Não usa chave do projeto nem valida produção. Procedimento completo: docs/seguranca/turnstile.md
// Teste em navegador real (Chromium) do Turnstile com chaves de TESTE oficiais da Cloudflare.
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL;
const EXPECT = process.env.EXPECT; // pass | invalid | expired
const results = [];
const log = (ok, msg) => { results.push(ok); console.log(`${ok ? "OK  " : "FALHA"} ${msg}`); };

(async () => {
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
  const browser = await chromium.launch({ proxy });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const violations = [];
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} -> ${e.blockedURI}`));
  });
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  async function token() {
    await page.waitForSelector('input[name="cf-turnstile-response"]', { state: "attached", timeout: 40000 });
    await page.waitForFunction(() => { const i = document.querySelector('input[name="cf-turnstile-response"]'); return i && i.value && i.value.length > 10; }, null, { timeout: 40000 });
    return page.$eval('input[name="cf-turnstile-response"]', (i) => i.value);
  }
  const resultText = async () => (await page.locator("form [role=alert], form p.text-red, form .text-red, form [class*=red]").allInnerTexts()).join(" | ");
  async function anyText(re) { return page.waitForFunction((src) => new RegExp(src, "i").test(document.body.innerText), re.source, { timeout: 20000 }).then(() => true).catch(() => false); }

  // ---------- LOGIN ----------
  await page.goto(`${BASE}/cadastro?mode=login`, { waitUntil: "domcontentloaded" });
  // A chave de teste "sempre aprova" é invisível (sem iframe) e devolve sempre o mesmo token literal.
  const rendered = await page.waitForFunction(() => { const el = document.querySelector('div[aria-label="Verificação anti-robô"]'); return el && el.getBoundingClientRect().height > 0 && el.querySelector("input[name=cf-turnstile-response]"); }, null, { timeout: 40000 }).then(() => true).catch(() => false);
  log(rendered, "widget Turnstile renderizou dentro do formulário de login (container com altura e campo oculto)");
  const t1 = await token().catch(() => null);
  log(Boolean(t1), "token gerado e gravado no campo oculto do formulário");
  await page.fill('input[name="email"]', "teste@exemplo.com");
  await page.fill('input[name="password"]', "Senha-de-teste-123");
  await page.click('button[type="submit"]');
  // Reinício após a resposta: o campo é esvaziado e preenchido de novo (a chave de teste repete o mesmo texto, então
  // "token novo" não é observável; o esvaziamento + novo preenchimento prova o reset()).
  const seq = [];
  for (let i = 0; i < 24; i++) { await page.waitForTimeout(500); seq.push(await page.$eval('input[name="cf-turnstile-response"]', (i2) => i2.value.length).catch(() => -1)); }
  const cleared = seq.some((n) => n === 0), refilled = seq.length && seq[seq.length - 1] > 10;
  log(cleared && refilled, `após a resposta da ação o widget foi reiniciado (campo esvaziado e preenchido de novo): ${seq.slice(0, 8).join(",")}…`);

  if (EXPECT === "pass") {
    const robot = await anyText(/n[ãa]o [ée] um rob[ôo]/);
    log(!robot, "login com token válido NÃO foi barrado pela verificação anti-robô (seguiu para a autenticação)");
  } else if (EXPECT === "invalid") {
    log(await anyText(/Confirme que voc[êe] n[ãa]o [ée] um rob[ôo]/), "servidor recusou: segredo que reprova (token não vale mesmo com widget resolvido no navegador)");
  } else if (EXPECT === "expired") {
    log(await anyText(/expirou ou j[áa] foi usada/), "servidor recusou como expirado/já usado");
  }

  // ---------- CADASTRO (formulário vazio: a verificação roda ANTES das validações) ----------
  await page.goto(`${BASE}/cadastro`, { waitUntil: "domcontentloaded" });
  await token().then(() => log(true, "cadastro: widget gerou token")).catch(() => log(false, "cadastro: widget não gerou token"));
  await page.evaluate(() => document.querySelector("form button[type=submit]")?.removeAttribute("disabled"));
  await page.evaluate(() => { for (const i of document.querySelectorAll("form input[required]")) i.removeAttribute("required"); });
  await page.click('form button[type="submit"]');
  if (EXPECT === "pass") log(await anyText(/Informe o nome da sua loja/), "cadastro: passou na verificação anti-robô e chegou às validações do formulário");
  else log(await anyText(EXPECT === "invalid" ? /n[ãa]o [ée] um rob[ôo]/ : /expirou ou j[áa] foi usada/), "cadastro: barrado pelo servidor");

  // ---------- RECUPERAR SENHA ----------
  await page.goto(`${BASE}/recuperar-senha`, { waitUntil: "domcontentloaded" });
  await token().then(() => log(true, "recuperar senha: widget gerou token")).catch(() => log(false, "recuperar senha: widget não gerou token"));
  await page.fill('input[name="email"]', "teste@exemplo.com");
  await page.click('form button[type="submit"]');
  if (EXPECT === "pass") log(!(await anyText(/n[ãa]o [ée] um rob[ôo]/)), "recuperar senha: não foi barrada pela verificação anti-robô");
  else log(await anyText(EXPECT === "invalid" ? /n[ãa]o [ée] um rob[ôo]/ : /expirou ou j[áa] foi usada/), "recuperar senha: barrada pelo servidor");

  // ---------- CSP ----------
  const csp = await page.evaluate(() => window.__csp);
  log(csp.length === 0, `nenhuma violação de CSP no navegador${csp.length ? ": " + csp.join(" ; ") : ""}`);
  log(consoleErrors.length === 0, `nenhum erro de JavaScript não tratado${consoleErrors.length ? ": " + consoleErrors.join(" ; ").slice(0, 300) : ""}`);
  await browser.close();
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.log("ERRO DO SCRIPT:", e.message.split("\n")[0]); process.exit(2); });
