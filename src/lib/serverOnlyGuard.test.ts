import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda estática das credenciais de servidor da cobrança: a chave service_role
 * do Supabase, as chaves do Asaas e do Mercado Pago (token da API e segredo do
 * webhook) e o CRON_SECRET só podem existir em código que
 * roda no servidor. Se alguém importar esses módulos de um componente de cliente
 * ou prefixar a variável com NEXT_PUBLIC_, o teste falha.
 */
const SRC = path.resolve(__dirname, "..");

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const all = walk(SRC);
const rel = (f: string) => path.relative(SRC, f).replaceAll("\\", "/");
const isTest = (f: string) => /\.test\.tsx?$/.test(f);
const prod = all.filter((f) => !isTest(f));
const read = (f: string) => fs.readFileSync(f, "utf8");

const SERVER_ONLY_MODULES = [
  "supabase/admin",
  "lib/asaas",
  "lib/mercadopago",
  "billingConfig",
  "billingReconcile",
  "asaasWebhookHandler",
  "mercadopagoWebhookHandler",
];

const importsModule = (source: string, modulePath: string) =>
  new RegExp(`from\\s+["'][^"']*${modulePath.replace("/", "\\/")}["']`).test(source);

describe("credenciais de servidor da cobrança", () => {
  it("a chave service_role só é lida em src/lib/supabase/admin.ts", () => {
    const users = prod.filter((f) => read(f).includes("SUPABASE_SERVICE_ROLE_KEY")).map(rel);
    expect(users).toEqual(["lib/supabase/admin.ts"]);
  });

  it("a chave do Asaas só é lida em src/lib/asaas.ts", () => {
    const users = prod.filter((f) => read(f).includes("process.env.ASAAS_API_KEY")).map(rel);
    expect(users).toEqual(["lib/asaas.ts"]);
  });

  it("o token do Mercado Pago só é lido em src/lib/mercadopago.ts", () => {
    const users = prod.filter((f) => read(f).includes("process.env.MERCADOPAGO_ACCESS_TOKEN")).map(rel);
    expect(users).toEqual(["lib/mercadopago.ts"]);
  });

  it("o segredo do webhook do Mercado Pago só é lido na rota do webhook", () => {
    const users = prod.filter((f) => read(f).includes("process.env.MERCADOPAGO_WEBHOOK_SECRET")).map(rel);
    expect(users).toEqual(["app/api/webhooks/mercadopago/route.ts"]);
  });

  it("o CRON_SECRET só é lido na rota agendada", () => {
    const users = prod.filter((f) => read(f).includes("process.env.CRON_SECRET")).map(rel);
    expect(users).toEqual(["app/api/cron/billing-reconcile/route.ts"]);
  });

  it("nenhuma credencial de servidor ganha o prefixo NEXT_PUBLIC_", () => {
    const offenders = all.filter((f) => /NEXT_PUBLIC_(SUPABASE_SERVICE|SERVICE_ROLE|ASAAS|MERCADOPAGO|CRON)/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("o cliente administrativo só é importado por quem roda no servidor e por quem precisa dele", () => {
    const importers = prod.filter((f) => importsModule(read(f), "supabase/admin")).map(rel).sort();
    expect(importers).toEqual([
      "app/api/cron/billing-reconcile/route.ts",
      "app/api/webhooks/mercadopago/route.ts",
      "lib/actions/subscription.ts",
      "lib/billingConfig.ts",
    ]);
  });

  it("nenhum componente de cliente ('use client') importa módulos de servidor da cobrança", () => {
    const clientFiles = prod.filter((f) => /^\s*["']use client["']/.test(read(f)));
    expect(clientFiles.length).toBeGreaterThan(0); // o teste enxerga os componentes de cliente
    const offenders: string[] = [];
    for (const f of clientFiles) {
      const source = read(f);
      for (const mod of SERVER_ONLY_MODULES) {
        if (importsModule(source, mod)) offenders.push(`${rel(f)} -> ${mod}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("o código de cobrança não escreve nada em log (console) nem devolve a mensagem crua de erro", () => {
    const billingFiles = [
      "lib/supabase/admin.ts",
      "lib/asaas.ts",
      "lib/billingConfig.ts",
      "lib/billingVerify.ts",
      "lib/billingReconcile.ts",
      "lib/asaasWebhook.ts",
      "lib/asaasWebhookHandler.ts",
      "lib/subscribeFlow.ts",
      "lib/sentryScrub.ts",
      "lib/actions/subscription.ts",
      "lib/mercadopago.ts",
      "lib/mercadopagoVerify.ts",
      "lib/mercadopagoWebhook.ts",
      "lib/mercadopagoWebhookHandler.ts",
      "lib/subscribeFlowMp.ts",
      "lib/pendingPaymentLink.ts",
      "lib/actions/pendingPayment.ts",
      "app/api/webhooks/asaas/route.ts",
      "app/api/webhooks/mercadopago/route.ts",
      "app/api/cron/billing-reconcile/route.ts",
    ];
    for (const file of billingFiles) {
      expect(read(path.join(SRC, file)), file).not.toMatch(/console\.(log|error|warn|info|debug)/);
    }
  });

  it("as rotas de cobrança nunca devolvem error.message do banco ao chamador", () => {
    for (const file of [
      "app/api/webhooks/asaas/route.ts",
      "app/api/webhooks/mercadopago/route.ts",
      "app/api/cron/billing-reconcile/route.ts",
      "lib/asaasWebhookHandler.ts",
      "lib/mercadopagoWebhookHandler.ts",
    ]) {
      const body = read(path.join(SRC, file));
      expect(body, file).not.toMatch(/(error|err)\.message\s*[,}\])]/);
      expect(body, file).not.toMatch(/json\(\s*\{[^}]*\berror\s*:\s*(error|err)\.message/);
    }
  });
});
