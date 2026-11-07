// Verificação em NAVEGADOR REAL (Chromium via Playwright) do Turnstile com chaves de TESTE oficiais da Cloudflare.
// Não usa chave do projeto nem valida produção. Procedimento completo: docs/seguranca/turnstile.md
const { chromium } = require("playwright");
const MODE = process.env.MODE; // interactive | blocking
(async () => {
  const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } });
  const page = await (await browser.newContext()).newPage();
  await page.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} -> ${e.blockedURI}`)); });
  await page.goto(`${process.env.BASE_URL}/cadastro?mode=login`, { waitUntil: "domcontentloaded" });
  let ok = true; const say = (c, m) => { ok = ok && c; console.log(`${c ? "OK  " : "FALHA"} ${m}`); };
  if (MODE === "interactive") {
    // o iframe fica num shadow root fechado: o seletor CSS não o vê, page.frames() sim
    let frame = false; for (let i = 0; i < 90 && !frame; i++) { frame = page.frames().some((f) => f.url().includes("challenges.cloudflare.com")); if (!frame) await page.waitForTimeout(500); }
    say(frame, "iframe do desafio interativo da Cloudflare carregou (CSP frame-src/script-src permitem a origem)");
    await page.waitForTimeout(3000);
    const tok = await page.$eval('input[name="cf-turnstile-response"]', (i) => i.value.length).catch(() => 0);
    say(tok === 0, "sem interação humana NENHUM token é gerado (desafio interativo pendente)");
    await page.fill('input[name="email"]', "teste@exemplo.com"); await page.fill('input[name="password"]', "Senha-de-teste-123");
    await page.click('button[type="submit"]');
    say(await page.waitForFunction(() => /n[ãa]o [ée] um rob[ôo]/i.test(document.body.innerText), null, { timeout: 20000 }).then(() => true).catch(() => false), "enviar sem resolver o desafio é recusado pelo servidor");
  } else {
    await page.waitForTimeout(12000);
    const tok = await page.$eval('input[name="cf-turnstile-response"]', (i) => i.value.length).catch(() => 0);
    say(tok === 0, "widget que sempre reprova NÃO gera token");
    await page.fill('input[name="email"]', "teste@exemplo.com"); await page.fill('input[name="password"]', "Senha-de-teste-123");
    await page.click('button[type="submit"]');
    say(await page.waitForFunction(() => /n[ãa]o [ée] um rob[ôo]/i.test(document.body.innerText), null, { timeout: 20000 }).then(() => true).catch(() => false), "enviar com widget reprovado é recusado pelo servidor");
  }
  const csp = await page.evaluate(() => window.__csp);
  say(csp.length === 0, `nenhuma violação de CSP${csp.length ? ": " + csp.join(" ; ") : ""}`);
  await browser.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.log("ERRO DO SCRIPT:", e.message.split("\n")[0]); process.exit(2); });
