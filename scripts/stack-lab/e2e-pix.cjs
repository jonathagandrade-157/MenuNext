// E2E SINTÉTICO do Pix automático (#29): navegador -> app (next dev, para aceitar o simulador em loopback) ->
// stack-lab (PostgreSQL + PostgREST) e SIMULADOR do Mercado Pago (fake-mercadopago.mjs). NÃO é homologação com o
// provedor. Uso: node e2e-pix.cjs <appUrl> <stackOutDir> <simUrl> <shotsDir>
const { chromium } = require("playwright");
const { execFileSync } = require("node:child_process");
const { createHmac } = require("node:crypto");
const fs = require("node:fs");

const [APP, OUT, SIM, SHOTS] = process.argv.slice(2);
const stack = JSON.parse(fs.readFileSync(`${OUT}/stack.json`, "utf8"));
const sql = (q) => execFileSync("/usr/lib/postgresql/16/bin/psql", ["-X", "-At", "-h", "127.0.0.1", "-p", "55440", "-U", "postgres", "-d", "postgres", "-c", q], { encoding: "utf8" }).trim();
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok }); console.log(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " — " + detail : ""}`); };
const SLUG = "pizzaria-lab";
const TOKEN = "TEST-sim-abcdefghijklmnopqrstuvwxyz0123"; // token SINTÉTICO aceito só pelo simulador
const WH_SECRET = "segredo-sintetico-do-webhook-0123456789";
const sim = async (path, method = "POST") => (await fetch(`${SIM}${path}`, { method })).json();
const sign = (dataId, requestId, ts) => `ts=${ts},v1=${createHmac("sha256", WH_SECRET).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest("hex")}`;
const webhook = (id, headers = {}) => fetch(`${APP}/api/webhooks/pix-mercadopago?data.id=${id}&type=payment`, {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ type: "payment", action: "payment.updated", data: { id: String(id) } }),
});

// preenche de novo até o botão habilitar (em `next dev` a página pode hidratar depois do primeiro preenchimento)
async function fillUntilEnabled(page, input, value, button) {
  for (let i = 0; i < 40; i++) {
    await input.fill("");
    await input.fill(value);
    if (await button.isEnabled()) return;
    await page.waitForTimeout(500);
  }
  throw new Error("botão não habilitou");
}

async function pixOrder(page, name) {
  await page.goto(`${APP}/loja/${SLUG}`, { waitUntil: "networkidle" });
  await page.locator("a", { hasText: "Suco de Laranja" }).first().click();
  await page.waitForURL(/\/produto\//);
  const add = page.getByRole("button", { name: /Adicionar à sacola/ });
  await add.waitFor();
  await page.waitForTimeout(800);
  await add.click();
  await page.waitForURL(new RegExp(`/loja/${SLUG}$`));
  await page.goto(`${APP}/loja/${SLUG}/checkout`, { waitUntil: "networkidle" });
  const go = page.getByRole("button", { name: /Ir para o checkout/ });
  if (await go.count()) { await go.first().click(); await page.locator("#customerName").waitFor({ timeout: 30000 }); }
  await page.fill("#customerName", name);
  await page.fill("#customerPhone", "(11) 98888-7777");
  for (const [ph, v] of [["CEP", "01001000"], ["Rua", "Praça da Sé"], ["Número", "100"], ["Bairro", "Sé"], ["Cidade", "São Paulo"], ["UF", "SP"]]) await page.getByPlaceholder(ph).fill(v);
  await page.getByRole("button", { name: /^Pix$/ }).first().click();
  await page.getByRole("button", { name: /Finalizar pedido ·/ }).click();
  await page.waitForURL(/\/pedido\//, { timeout: 60000 });
  await page.waitForLoadState("networkidle");
  return page.url().split("/pedido/")[1].split(/[/?]/)[0];
}

(async () => {
  const browser = await chromium.launch();
  // ---------------- 1) OWNER configura no painel ----------------
  const owner = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await owner.addCookies([{ name: stack.sessions.ownerA.cookieName, value: stack.sessions.ownerA.cookieValue, domain: "127.0.0.1", path: "/" }]);
  const op = await owner.newPage();
  await op.goto(`${APP}/painel/pagamentos`, { waitUntil: "networkidle" });
  check("painel: cartão do Pix automático aparece com o servidor configurado", await op.getByText("Pix automático (Mercado Pago)").isVisible());
  const tokenInput = op.getByPlaceholder("APP_USR-...");
  const saveToken = op.getByRole("button", { name: "Salvar token" });
  await fillUntilEnabled(op, tokenInput, "TEST-recusado-abcdefghijklmnopqrstuvwxyz", saveToken);
  await saveToken.click();
  const refused = await op.getByText(/recusou este token/).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  check("painel: token recusado pelo provedor não é salvo", refused && sql("select count(*) from public.restaurant_pix_settings") === "0");
  await fillUntilEnabled(op, tokenInput, TOKEN, saveToken);
  await saveToken.click();
  await op.getByText(/Token salvo/).waitFor({ timeout: 20000 });
  const saved = sql("select collector_id || '|' || token_hint || '|' || enabled || '|' || (position('TEST-sim' in token_ciphertext) = 0) from public.restaurant_pix_settings");
  check("painel: token salvo cifrado, conta recebedora lida da API, nasce desligado", saved === "777|0123|false|true", saved);
  const saveSecret = op.getByRole("button", { name: "Salvar assinatura" });
  await fillUntilEnabled(op, op.getByLabel("Assinatura secreta de webhooks"), WH_SECRET, saveSecret);
  await saveSecret.click();
  await op.getByText(/Assinatura secreta salva/).waitFor({ timeout: 20000 });
  await op.getByRole("button", { name: "Ligar Pix automático" }).click();
  await op.getByText(/Pix automático ligado/).waitFor({ timeout: 20000 });
  check("painel: assinatura do webhook cifrada e recurso ligado", sql("select enabled || '|' || (webhook_secret_ciphertext is not null) || '|' || (position('segredo' in coalesce(webhook_secret_ciphertext,'')) = 0) from public.restaurant_pix_settings") === "true|true|true");
  const html = await op.content();
  check("painel: token e segredo nunca voltam para o navegador", !html.includes(TOKEN) && !html.includes(WH_SECRET));
  await op.screenshot({ path: `${SHOTS}/pix-1-painel.png`, fullPage: true });

  // ---------------- 2) cliente: pedido Pix com QR dinâmico ----------------
  const customer = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  const pub1 = await pixOrder(customer, "Cliente Pix");
  await customer.getByText(/Aguardando pagamento/).waitFor({ timeout: 30000 });
  check("cliente: QR dinâmico e copia e cola; chave Pix comum NÃO aparece", (await customer.getByRole("img", { name: "QR Code Pix do pedido" }).count()) === 1 && !(await customer.innerText("body")).includes("pix@stack.test"));
  const charge1 = sql(`select c.status || '|' || c.amount || '|' || o.total || '|' || c.provider_payment_id from public.order_pix_charges c join public.orders o on o.id = c.order_id where o.public_id = '${pub1}'`);
  const [, amount1, total1, payId1] = charge1.split("|");
  check("cobrança com o total calculado pelo servidor", charge1.startsWith("pending|") && amount1 === total1, charge1);
  await customer.screenshot({ path: `${SHOTS}/pix-2-qr.png`, fullPage: true });

  // ---------------- 3) webhook: assinatura, consulta ao provedor, confirmação ----------------
  let r = await webhook(payId1);
  check("webhook sem assinatura (loja com segredo) = 401", r.status === 401);
  const tampered = sign(payId1, "req-1", "1762560000").replace(/.$/, (c) => (c === "0" ? "1" : "0"));
  r = await webhook(payId1, { "x-signature": tampered, "x-request-id": "req-1" });
  check("webhook com assinatura adulterada = 401", r.status === 401);
  r = await webhook(payId1, { "x-signature": sign(payId1, "req-2", "1762560001"), "x-request-id": "req-2" });
  check("webhook assinado, pagamento ainda pendente no provedor: nada muda", r.status === 200 && sql(`select status from public.order_pix_charges where provider_payment_id = '${payId1}'`) === "pending");
  await sim(`/__sim/approve/${pub1}`);
  r = await webhook(payId1, { "x-signature": sign(payId1, "req-3", "1762560002"), "x-request-id": "req-3" });
  check("webhook assinado após pagamento: confirmado pela consulta ao provedor", r.status === 200 && sql(`select status from public.order_pix_charges where provider_payment_id = '${payId1}'`) === "approved" && sql(`select paid_at is not null from public.orders where public_id = '${pub1}'`) === "t");
  r = await webhook(payId1, { "x-signature": sign(payId1, "req-4", "1762560003"), "x-request-id": "req-4" });
  check("aviso duplicado depois de pago: 200 e continua pago", r.status === 200 && sql(`select status from public.order_pix_charges where provider_payment_id = '${payId1}'`) === "approved");
  await customer.getByText(/confirmado/).waitFor({ timeout: 30000 });
  check("cliente: a página mostra o pagamento confirmado sozinha", true);
  await customer.screenshot({ path: `${SHOTS}/pix-3-confirmado.png`, fullPage: true });

  // painel: pedido marcado como pago
  const orderId1 = sql(`select id from public.orders where public_id = '${pub1}'`);
  await op.goto(`${APP}/painel/pedidos?order=${orderId1}`, { waitUntil: "networkidle" });
  await op.getByText("Pix automático confirmado pelo Mercado Pago.").waitFor({ timeout: 30000 });
  check("painel: pedido mostra Pix confirmado e 'Pago'", await op.getByText("Pago", { exact: true }).first().isVisible());
  await op.screenshot({ path: `${SHOTS}/pix-4-painel-pedido.png` });

  // ---------------- 4) resposta indefinida: "gerando", sem chave comum, mesma cobrança ----------------
  await sim("/__sim/mode/undefined-once");
  const c2 = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  const pub2 = await pixOrder(c2, "Cliente Indefinido");
  await c2.getByText(/Gerando o QR Code Pix|Aguardando pagamento/).first().waitFor({ timeout: 30000 });
  const text2 = await c2.innerText("body");
  check("resposta indefinida: página mostra 'gerando' e NÃO mostra a chave Pix comum", /Gerando o QR Code Pix/.test(text2) && !text2.includes("pix@stack.test"), text2.replace(/\s+/g, " ").slice(0, 160));
  await c2.getByText(/Aguardando pagamento/).waitFor({ timeout: 60000 });
  const state = await sim("/__sim/state", "GET");
  const created2 = state.payments.filter((p) => p.external_reference === pub2).length;
  check("retomada: QR aparece e o provedor tem UMA cobrança para o pedido (idempotência)", created2 === 1 && (await c2.getByRole("img", { name: "QR Code Pix do pedido" }).count()) === 1, `cobranças=${created2}`);

  // ---------------- 5) recusa definitiva: chave comum com conferência manual ----------------
  await sim("/__sim/mode/reject");
  const c3 = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  const pub3 = await pixOrder(c3, "Cliente Recusado");
  await c3.getByText(/confere esse pagamento manualmente/).waitFor({ timeout: 30000 });
  check("recusa definitiva: chave Pix comum com aviso de conferência manual", (await c3.innerText("body")).includes("pix@stack.test") && sql(`select c.status from public.order_pix_charges c join public.orders o on o.id = c.order_id where o.public_id = '${pub3}'`) === "failed");
  await c3.screenshot({ path: `${SHOTS}/pix-5-recusado.png`, fullPage: true });
  const orderId3 = sql(`select id from public.orders where public_id = '${pub3}'`);
  await op.goto(`${APP}/painel/pedidos?order=${orderId3}`, { waitUntil: "networkidle" });
  check("painel: pedido com Pix não concluído pede conferência no extrato", await op.getByText(/confira no extrato/).first().isVisible({ timeout: 30000 }).catch(() => false));

  // ---------------- 6) conta recebedora diferente nunca vira QR ----------------
  await sim("/__sim/mode/wrong-collector");
  const c4 = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  const pub4 = await pixOrder(c4, "Cliente Conta Errada");
  await c4.getByText(/confere esse pagamento manualmente/).waitFor({ timeout: 30000 });
  check("cobrança criada em OUTRA conta: descartada (sem QR)", sql(`select c.status || ':' || c.failure_reason from public.order_pix_charges c join public.orders o on o.id = c.order_id where o.public_id = '${pub4}'`) === "failed:provider_mismatch");
  await sim("/__sim/mode/ok");

  await browser.close();
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\nRESULTADO E2E PIX: ${results.length - failed}/${results.length} OK`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
