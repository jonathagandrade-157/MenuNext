// E2E SINTÉTICO das variantes (#16 + #27): navegador real -> app (build de produção) -> gateway -> PostgREST ->
// PostgreSQL com todas as migrations. Dados falsos do seed.sql. Uso: node e2e-variants.cjs <appUrl> <stackOutDir> <shotsDir>
const { chromium, devices } = require("playwright");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

const [APP, OUT, SHOTS] = process.argv.slice(2);
const stack = JSON.parse(fs.readFileSync(`${OUT}/stack.json`, "utf8"));
const sql = (q) =>
  execFileSync("/usr/lib/postgresql/16/bin/psql", ["-X", "-At", "-h", "127.0.0.1", "-p", "55440", "-U", "postgres", "-d", "postgres", "-c", q], { encoding: "utf8" }).trim();
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " — " + detail : ""}`); };
const SLUG = "pizzaria-lab";
const PIZZA = "00000000-0000-4000-8000-0000000a1001", SUCO = "00000000-0000-4000-8000-0000000a1002", ESFIHA = "00000000-0000-4000-8000-0000000a1003";
const V_P = "00000000-0000-4000-8000-0000000a2001", V_M = "00000000-0000-4000-8000-0000000a2002", V_G = "00000000-0000-4000-8000-0000000a2003", V_B = "00000000-0000-4000-8000-0000000b2001";

async function rpcCreateOrder(items, key) {
  const r = await fetch(`${stack.url}/rest/v1/rpc/create_order`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${stack.anonKey}`, apikey: stack.anonKey },
    body: JSON.stringify({ p_slug: SLUG, p_customer_name: "Cliente", p_customer_phone: "11988887777", p_fulfillment_type: "pickup", p_payment_method: "cash", p_items: items, p_idempotency_key: key }),
  });
  return { status: r.status, body: await r.text() };
}

async function checkout(page, name) {
  await page.goto(`${APP}/loja/${SLUG}/checkout`, { waitUntil: "networkidle" });
  const goCheckout = page.getByRole("button", { name: /Ir para o checkout/ });
  if (await goCheckout.count()) {
    await goCheckout.first().click();
    await page.locator("#customerName").waitFor({ timeout: 15000 });
  }
  await page.fill("#customerName", name);
  await page.fill("#customerPhone", "(11) 98888-7777");
  await page.getByPlaceholder("CEP").fill("01001000");
  await page.getByPlaceholder("Rua").fill("Praça da Sé");
  await page.getByPlaceholder("Número").fill("100");
  await page.getByPlaceholder("Bairro").fill("Sé");
  await page.getByPlaceholder("Cidade").fill("São Paulo");
  await page.getByPlaceholder("UF").fill("SP");
  const cash = page.getByRole("button", { name: /Dinheiro/ }).first();
  if (await cash.count()) await cash.click();
  else await page.getByText("Dinheiro", { exact: false }).first().click();
  await page.getByRole("button", { name: /Finalizar pedido ·/ }).click();
}

(async () => {
  const browser = await chromium.launch();

  // ---------------- 1) cardápio e página do produto (visitante, celular) ----------------
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await page.goto(`${APP}/loja/${SLUG}`, { waitUntil: "networkidle" });
  const pizzaCard = page.locator("a", { hasText: "Pizza Calabresa" }).first();
  check("cardápio: Pizza com variantes mostra 'a partir de R$ 35,00'", /a partir de\s*R\$\s*35,00/.test(await pizzaCard.innerText()), (await pizzaCard.innerText()).replace(/\s+/g, " "));
  const sucoCard = page.locator("a", { hasText: "Suco de Laranja" }).first();
  check("cardápio: produto sem variantes mostra o preço normal", /R\$\s*8,00/.test(await sucoCard.innerText()) && !/a partir/.test(await sucoCard.innerText()));
  await page.screenshot({ path: `${SHOTS}/1-cardapio.png` });

  await pizzaCard.click();
  await page.waitForURL(/\/produto\//);
  await page.waitForLoadState("networkidle");
  const addBtn = page.getByRole("button", { name: /Adicionar à sacola/ });
  await page.getByRole("radio", { name: /Pequena/ }).waitFor(); // a URL muda antes de a página renderizar
  await page.waitForTimeout(500); // hidratação
  check("produto: botão desabilitado antes de escolher a opção", await addBtn.isDisabled());
  const grande = page.getByRole("radio", { name: /Grande/ });
  check("produto: variante desligada (Grande) não pode ser escolhida", await grande.isDisabled());
  await page.getByRole("radio", { name: /Media/ }).check();
  await page.getByRole("button", { name: "+" }).click();
  check("produto: preço e subtotal pela variante (2 x 55,50 = 111,00)", /111,00/.test(await addBtn.innerText()), await addBtn.innerText());
  await page.screenshot({ path: `${SHOTS}/2-produto-variante.png` });
  await addBtn.click();
  await page.waitForURL(new RegExp(`/loja/${SLUG}$`));
  await page.locator("a", { hasText: "Suco de Laranja" }).first().click();
  await page.waitForURL(/\/produto\//);
  await page.waitForLoadState("networkidle");
  check("produto sem variantes: sem seletor", (await page.getByRole("radio").count()) === 0);
  await page.getByRole("button", { name: /Adicionar à sacola/ }).click();
  await page.waitForURL(new RegExp(`/loja/${SLUG}$`));

  // ---------------- 2) checkout real ----------------
  await checkout(page, "Cliente Variante");
  await page.waitForURL(/\/pedido\//, { timeout: 15000 });
  const publicId = page.url().split("/pedido/")[1].split(/[/?]/)[0];
  const order = sql(`select subtotal || '|' || total from public.orders where public_id = '${publicId}'`);
  check("checkout: subtotal calculado no servidor (111,00 + 8,00) + entrega 5,00", order === "119.00|124.00", order);
  const items = sql(`select string_agg(product_name || '=' || unit_price || 'x' || quantity || ':' || coalesce(variant_name,'-'), ' ; ' order by product_name) from public.order_items i join public.orders o on o.id = i.order_id where o.public_id = '${publicId}'`);
  check("checkout: item gravado como 'Produto — Variante' com o preço da variante", items === "Pizza Calabresa — Media=55.50x2:Media ; Suco de Laranja=8.00x1:-", items);
  await page.screenshot({ path: `${SHOTS}/3-pedido.png` });

  // ---------------- 3) manipulação pela sacola (localStorage) ----------------
  const bagKey = `menunext-bag-${SLUG}`;
  const forged = [
    { name: "variante de OUTRA loja com preço 1", item: { variantId: V_B, basePrice: 1, subtotal: 1 }, expect: /não existe mais/ },
    { name: "variante DESLIGADA", item: { variantId: V_G, basePrice: 1, subtotal: 1 }, expect: /indisponível/ },
    { name: "sem variante (sacola antiga) em produto com variantes", item: { variantId: undefined, basePrice: 1, subtotal: 1 }, expect: /agora tem opções/ },
  ];
  for (const f of forged) {
    await page.evaluate(([k, it]) => {
      const base = { key: "x", productId: "00000000-0000-4000-8000-0000000a1001", name: "Pizza", imageUrl: null, quantity: 1, observation: "", selectedAddons: [] };
      localStorage.setItem(k, JSON.stringify([{ ...base, ...it }]));
    }, [bagKey, f.item]);
    const before = sql("select count(*) from public.orders");
    await checkout(page, "Cliente Fraude");
    const err = page.getByText(f.expect).first();
    let shown = false;
    try { await err.waitFor({ timeout: 8000 }); shown = true; } catch {}
    check(`manipulação recusada com mensagem: ${f.name}`, shown && sql("select count(*) from public.orders") === before, page.url());
  }
  await page.evaluate((k) => localStorage.removeItem(k), bagKey);

  // ---------------- 4) manipulação direto na API (mesma entrada da Server Action) ----------------
  const api = [
    ["preço forjado no JSON é ignorado", [{ product_id: PIZZA, quantity: 1, variant_id: V_P, price: 0.01, unit_price: 0.01, subtotal: 0.01 }], "ok:35.00"],
    ["variante de outro produto", [{ product_id: SUCO, quantity: 1, variant_id: V_M }], "variant_not_found"],
    ["variante de outra loja", [{ product_id: PIZZA, quantity: 1, variant_id: V_B }], "variant_not_found"],
    ["variante desligada", [{ product_id: PIZZA, quantity: 1, variant_id: V_G }], "variant_unavailable"],
    ["produto com variantes sem escolha", [{ product_id: PIZZA, quantity: 1 }], "variant_required"],
    ["id malformado", [{ product_id: PIZZA, quantity: 1, variant_id: "abc" }], "invalid_items"],
  ];
  let n = 0;
  for (const [name, items2, expected] of api) {
    const key = `api-${++n}-${Date.now()}`;
    const r = await rpcCreateOrder(items2, key);
    let got = r.body;
    if (expected.startsWith("ok:")) got = r.status === 200 ? "ok:" + sql(`select subtotal from public.orders where idempotency_key = '${key}'`) : r.body;
    check(`API: ${name}`, expected.startsWith("ok:") ? got === expected : got.includes(expected), got.slice(0, 120));
  }

  // ---------------- 5) painel: cadastro, edição e desativação (OWNER) ----------------
  const owner = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await owner.addCookies([{ name: stack.sessions.ownerA.cookieName, value: stack.sessions.ownerA.cookieValue, domain: "127.0.0.1", path: "/" }]);
  const op = await owner.newPage();
  await op.goto(`${APP}/painel/variantes`, { waitUntil: "networkidle" });
  await op.locator("select").first().selectOption(ESFIHA);
  await op.getByLabel("Nome da variante").fill("Grande");
  await op.getByLabel("Preço da variante").fill("9,50");
  await op.getByRole("button", { name: "Adicionar" }).click();
  await op.waitForTimeout(1500);
  check("painel: OWNER cadastra variante", sql(`select name || '=' || price || ':' || is_available from public.product_variants where product_id = '${ESFIHA}'`) === "Grande=9.50:true");
  await op.getByRole("button", { name: "Editar" }).first().click();
  await op.getByLabel("Nome", { exact: true }).fill("Gigante");
  await op.getByLabel("Preço", { exact: true }).fill("11");
  await op.getByRole("button", { name: "Salvar" }).click();
  await op.waitForTimeout(1500);
  check("painel: OWNER edita nome e preço", sql(`select name || '=' || price from public.product_variants where product_id = '${ESFIHA}'`) === "Gigante=11.00");
  await op.getByRole("button", { name: /Disponível/ }).first().click();
  await op.waitForTimeout(1500);
  check("painel: OWNER desliga a variante", sql(`select is_available from public.product_variants where product_id = '${ESFIHA}'`) === "f");
  await op.screenshot({ path: `${SHOTS}/4-painel-variantes.png` });
  await page.goto(`${APP}/loja/${SLUG}`, { waitUntil: "networkidle" });
  const esfihaCard = page.locator("a", { hasText: "Esfiha" }).first();
  check("cardápio: produto com TODAS as variantes desligadas aparece indisponível", /Indisponível/.test(await esfihaCard.innerText()), (await esfihaCard.innerText()).replace(/\s+/g, " "));

  // STAFF não cadastra (só liga/desliga)
  const staff = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await staff.addCookies([{ name: stack.sessions.staffA.cookieName, value: stack.sessions.staffA.cookieValue, domain: "127.0.0.1", path: "/" }]);
  const sp = await staff.newPage();

  // ---------------- 6) PDV (STAFF, caixa aberto) ----------------
  await sp.goto(`${APP}/painel/caixa`, { waitUntil: "networkidle" });
  check("PDV: produto com todas as variantes desligadas fica indisponível", await sp.getByRole("button", { name: /Esfiha/ }).first().isDisabled());
  await sp.getByRole("button", { name: /Pizza Calabresa/ }).first().click();
  await sp.getByRole("radio", { name: /Pequena/ }).waitFor({ timeout: 10000 });
  check("PDV: seletor de variante aparece; desligada bloqueada", await sp.getByRole("radio", { name: /Grande/ }).isDisabled());
  await sp.getByRole("button", { name: /^Adicionar ·/ }).click();
  check("PDV: adicionar sem escolher mostra erro", await sp.getByText(/Escolha uma opção/).first().isVisible());
  await sp.getByRole("radio", { name: /Pequena/ }).check();
  await sp.getByRole("button", { name: /^Adicionar ·/ }).click();
  await sp.screenshot({ path: `${SHOTS}/5-pdv.png` });
  const beforePdv = sql("select count(*) from public.orders where fulfillment_type = 'counter'");
  await sp.getByRole("button", { name: /Finalizar venda/ }).click();
  await sp.waitForTimeout(3000);
  const pdv = sql("select o.subtotal || '|' || i.product_name || '|' || coalesce(i.variant_name, '-') from public.orders o join public.order_items i on i.order_id = o.id where o.fulfillment_type = 'counter' order by o.created_at desc limit 1");
  check("PDV: venda gravada com a variante e o preço dela", sql("select count(*) from public.orders where fulfillment_type = 'counter'") === String(Number(beforePdv) + 1) && pdv === "35.00|Pizza Calabresa — Pequena|Pequena", pdv);

  // ---------------- 7) histórico: apagar a variante não muda o pedido ----------------
  sql(`select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a001","role":"authenticated"}', false)`);
  execFileSync("/usr/lib/postgresql/16/bin/psql", ["-X", "-At", "-h", "127.0.0.1", "-p", "55440", "-U", "postgres", "-d", "postgres", "-c",
    `set request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000a001","role":"authenticated"}'; select public.product_variant_delete('${V_M}');`]);
  const hist = sql(`select i.product_name || '|' || i.unit_price || '|' || coalesce(i.variant_id::text, 'null') || '|' || i.variant_name from public.order_items i join public.orders o on o.id = i.order_id where o.public_id = '${publicId}' and i.variant_name is not null`);
  check("histórico: variante apagada, item do pedido preservado", hist === "Pizza Calabresa — Media|55.50|null|Media", hist);

  await browser.close();
  fs.writeFileSync(`${SHOTS}/e2e-variants.json`, JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nRESULTADO E2E: ${results.length - failed}/${results.length} OK`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
