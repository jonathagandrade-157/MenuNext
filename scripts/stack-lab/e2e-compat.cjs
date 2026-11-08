// Compatibilidade de implantação das variantes, no stack SINTÉTICO. Uso: node e2e-compat.cjs <appUrl> <cenario>
//   sem-migrations : banco sem 20261105040000 e sem 20261108000000 (código novo publicado antes das migrations)
//   so-cadastro    : banco só com 20261105040000 (variantes cadastradas, create_order antigo)
//   rollback       : banco completo e, com o app no ar, os dois scripts de rollback aplicados
//   codigo-antigo  : app da main (sem variantes) com o banco completo e SEM variantes cadastradas
const { chromium } = require("playwright");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const [APP, MODE] = process.argv.slice(2);
const sql = (q) => execFileSync("/usr/lib/postgresql/16/bin/psql", ["-X", "-At", "-h", "127.0.0.1", "-p", "55440", "-U", "postgres", "-d", "postgres", "-c", q], { encoding: "utf8" }).trim();
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok }); console.log(`${ok ? "OK   " : "FALHA"} [${MODE}] ${name}${detail ? " — " + detail : ""}`); };
const SLUG = "pizzaria-lab";

async function order(page, label) {
  await page.goto(`${APP}/loja/${SLUG}`, { waitUntil: "networkidle" });
  await page.locator("a", { hasText: "Pizza Calabresa" }).first().click();
  await page.waitForURL(/\/produto\//);
  await page.waitForLoadState("networkidle");
  const add = page.getByRole("button", { name: /Adicionar à sacola/ });
  await add.waitFor(); // a URL muda antes de a página do produto renderizar (navegação no cliente)
  const radios = await page.getByRole("radio").count();
  // loja exige escolher (botão desabilitado até lá); repete o clique se a página ainda não hidratou
  for (let i = 0; radios > 0 && i < 20 && (await add.isDisabled()); i++) {
    await page.getByRole("radio", { name: /Media/ }).click();
    await page.waitForTimeout(250);
  }
  const addText = (await add.innerText()).replace(/\s+/g, " ");
  await add.click();
  await page.waitForURL(new RegExp(`/loja/${SLUG}$`));
  await page.goto(`${APP}/loja/${SLUG}/checkout`, { waitUntil: "networkidle" });
  const go = page.getByRole("button", { name: /Ir para o checkout/ });
  if (await go.count()) { await go.first().click(); await page.locator("#customerName").waitFor({ timeout: 15000 }); }
  await page.fill("#customerName", label);
  await page.fill("#customerPhone", "(11) 98888-7777");
  for (const [ph, v] of [["CEP", "01001000"], ["Rua", "Praça da Sé"], ["Número", "100"], ["Bairro", "Sé"], ["Cidade", "São Paulo"], ["UF", "SP"]]) await page.getByPlaceholder(ph).fill(v);
  await page.getByRole("button", { name: /Dinheiro/ }).first().click();
  await page.getByRole("button", { name: /Finalizar pedido ·/ }).click();
  await page.waitForURL(/\/pedido\//, { timeout: 15000 });
  const publicId = page.url().split("/pedido/")[1].split(/[/?]/)[0];
  return { radios, addText, row: sql(`select o.subtotal || '|' || i.product_name from public.orders o join public.order_items i on i.order_id = o.id where o.public_id = '${publicId}'`) };
}

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  if (MODE === "rollback") {
    // pedido COM variante antes do rollback (histórico)
    const before = await order(page, "Antes do rollback").catch((e) => ({ err: String(e) }));
    check("antes do rollback a loja exige variante (seletor presente)", before.radios === 3, JSON.stringify(before));
    execFileSync("/bin/sh", ["-c", "cat supabase/rollback/20261108000000_order_item_variants.down.sql supabase/rollback/20261105040000_product_variants.down.sql > /tmp/stack-out/apply.sql && kill -USR2 $(node -e 'console.log(require(\"/tmp/stack-out/stack.json\").pid)')"]);
    for (let i = 0; i < 40 && !fs.existsSync("/tmp/stack-out/apply.result"); i++) await new Promise((r) => setTimeout(r, 250));
    check("scripts de rollback aplicados com o app no ar", fs.readFileSync("/tmp/stack-out/apply.result", "utf8").startsWith("OK"), fs.readFileSync("/tmp/stack-out/apply.result", "utf8").trim());
    await new Promise((r) => setTimeout(r, 1500));
  }
  await page.goto(`${APP}/loja/${SLUG}`, { waitUntil: "networkidle" });
  const card = (await page.locator("a", { hasText: "Pizza Calabresa" }).first().innerText()).replace(/\s+/g, " ");
  check("cardápio sem 'a partir de' (preço do produto)", /R\$ 40,00/.test(card) && !/a partir/.test(card), card);
  const r = await order(page, `Compat ${MODE}`);
  check("produto sem seletor de variante", r.radios === 0, `radios=${r.radios}`);
  check("pedido pelo preço do produto (40,00), sem variante", r.row === "40.00|Pizza Calabresa", r.row);
  if (MODE === "rollback") {
    const old = sql("select count(*) from public.order_items where product_name = 'Pizza Calabresa — Media'");
    check("pedidos antigos mantêm o nome 'Produto — Variante'", old === "1", old);
  }
  if (MODE !== "codigo-antigo") {
    const ctx = await browser.newContext();
    const stack = JSON.parse(fs.readFileSync("/tmp/stack-out/stack.json", "utf8"));
    await ctx.addCookies([{ name: stack.sessions.ownerA.cookieName, value: stack.sessions.ownerA.cookieValue, domain: "127.0.0.1", path: "/" }]);
    const op = await ctx.newPage();
    await op.goto(`${APP}/painel/variantes`, { waitUntil: "networkidle" });
    const body = await op.innerText("body");
    if (MODE === "so-cadastro") check("painel: cadastro de variantes funciona (tabela existe)", /Pequena/.test(body));
    else check("painel: variantes indisponíveis neste ambiente (sem quebrar)", /indisponíveis neste ambiente/.test(body));
  }
  await browser.close();
  const failed = results.filter((x) => !x.ok).length;
  console.log(`RESULTADO [${MODE}]: ${results.length - failed}/${results.length} OK`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
