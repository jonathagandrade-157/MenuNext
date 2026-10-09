#!/usr/bin/env node
/**
 * Verifica, no SANDBOX do Asaas, as suposições da integração de cobrança do
 * MenuNext (sem pagamentos reais e sem tocar no banco do MenuNext).
 *
 * Uso (PowerShell ou bash; use SOMENTE uma chave de sandbox):
 *   ASAAS_API_KEY=<chave-sandbox> node scripts/asaas-sandbox-check.mjs            # só leitura
 *   ASAAS_API_KEY=<chave-sandbox> node scripts/asaas-sandbox-check.mjs --create   # cria e remove uma assinatura de teste
 *
 * Garantias:
 *  - Recusa rodar se ASAAS_ENV=production ou se a chave parecer de produção.
 *  - Só fala com https://api-sandbox.asaas.com (endereço fixo no código).
 *  - Nunca imprime a chave. Com --create, usa dados fictícios, valor R$ 5,00,
 *    e remove a assinatura criada no final (a menos que passe --keep).
 *
 * O que confere (cada item imprime OK/FALHOU):
 *  1. a chave funciona no sandbox;
 *  2. uma assinatura criada com externalReference pode ser lida de volta (GET) com
 *     cliente, valor, status e referência corretos;
 *  3. a listagem por externalReference encontra essa assinatura;
 *  4. a listagem de cobranças da assinatura responde (e mostra se o externalReference
 *     é herdado pelas cobranças: a documentação NAO garante, o MenuNext nao depende disso);
 *  5. a cobranca pode ser lida por GET /payments/{id};
 *  6. a assinatura criada pode ser removida (limpeza).
 */
const BASE = "https://api-sandbox.asaas.com/v3";
const apiKey = process.env.ASAAS_API_KEY ?? "";
const create = process.argv.includes("--create");
const keep = process.argv.includes("--keep");

if (process.env.ASAAS_ENV === "production") {
  console.error("RECUSADO: ASAAS_ENV=production. Este script só roda no sandbox.");
  process.exit(2);
}
if (!apiKey) {
  console.error("Defina ASAAS_API_KEY com uma chave de SANDBOX.");
  process.exit(2);
}
if (/^\$aact_prod_/i.test(apiKey)) {
  console.error("RECUSADO: a chave parece ser de PRODUÇÃO. Use uma chave de sandbox.");
  process.exit(2);
}

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "OK    " : "FALHOU"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

async function call(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", access_token: apiKey },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    /* corpo vazio */
  }
  return { status: response.status, ok: response.ok, json };
}

// CPF válido fictício, só para o cadastro de teste no sandbox.
function testCpf() {
  const digits = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const check = (list) => {
    const weight = list.length + 1;
    const sum = list.reduce((acc, d, i) => acc + d * (weight - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const d1 = check(digits);
  const d2 = check([...digits, d1]);
  return [...digits, d1, d2].join("");
}

const probe = await call("GET", "/customers?limit=1");
check("a chave funciona no sandbox (GET /customers)", probe.ok, `HTTP ${probe.status}`);
if (!probe.ok) {
  console.log("\nSem acesso ao sandbox: confira a chave. Nada mais foi executado.");
  process.exit(1);
}

if (!create) {
  console.log("\nModo leitura: a chave é válida. Rode com --create para validar criação, leitura e listagem de uma assinatura de teste.");
  process.exit(0);
}

const reference = `menunext-sandbox-${Date.now()}`;
const customer = await call("POST", "/customers", { name: "Teste MenuNext Sandbox", email: "sandbox@menunext.test", cpfCnpj: testCpf() });
check("cria cliente de teste", customer.ok && typeof customer.json?.id === "string", `HTTP ${customer.status}`);
if (!customer.ok) process.exit(1);

const due = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const created = await call("POST", "/subscriptions", {
  customer: customer.json.id,
  billingType: "UNDEFINED",
  value: 5.0,
  cycle: "MONTHLY",
  nextDueDate: due,
  description: "MenuNext sandbox E2E",
  externalReference: reference,
});
check("cria assinatura de teste com externalReference", created.ok && typeof created.json?.id === "string", `HTTP ${created.status}`);
if (!created.ok) process.exit(1);
const subId = created.json.id;

const read = await call("GET", `/subscriptions/${subId}`);
check(
  "lê a assinatura de volta (cliente, valor, status e referência)",
  read.ok &&
    read.json?.customer === customer.json.id &&
    Math.round(Number(read.json?.value) * 100) === 500 &&
    read.json?.status === "ACTIVE" &&
    read.json?.externalReference === reference &&
    !read.json?.deleted,
  `HTTP ${read.status}`
);

const found = await call("GET", `/subscriptions?externalReference=${encodeURIComponent(reference)}&limit=10`);
check(
  "listagem por externalReference encontra exatamente a assinatura",
  found.ok && Array.isArray(found.json?.data) && found.json.data.length === 1 && found.json.data[0]?.id === subId,
  `HTTP ${found.status}, ${found.json?.data?.length ?? "?"} resultado(s)`
);

const payments = await call("GET", `/subscriptions/${subId}/payments?offset=0&limit=100`);
check("lista as cobranças da assinatura", payments.ok && Array.isArray(payments.json?.data), `HTTP ${payments.status}, ${payments.json?.data?.length ?? "?"} cobrança(s)`);
const first = payments.json?.data?.[0];
if (first) {
  check("a cobrança traz assinatura, cliente, valor, status e vencimento", first.subscription === subId && first.customer === customer.json.id && typeof first.status === "string" && typeof first.dueDate === "string");
  console.log(`INFO    externalReference herdado pela cobrança: ${first.externalReference === reference ? "SIM" : "NAO (esperado: o MenuNext não depende disso)"}`);
  const one = await call("GET", `/payments/${first.id}`);
  check("GET /payments/{id} devolve a mesma cobrança", one.ok && one.json?.id === first.id && one.json?.subscription === subId, `HTTP ${one.status}`);
} else {
  console.log("INFO    nenhuma cobrança gerada ainda; confira de novo depois (o Asaas gera a primeira perto do vencimento).");
}

if (!keep) {
  const removed = await call("DELETE", `/subscriptions/${subId}`);
  check("remove a assinatura de teste", removed.ok, `HTTP ${removed.status}`);
} else {
  console.log(`INFO    assinatura mantida (--keep): ${subId}`);
}

console.log(failures === 0 ? "\nTUDO OK no sandbox." : `\n${failures} verificação(ões) FALHOU(aram).`);
process.exit(failures === 0 ? 0 : 1);
