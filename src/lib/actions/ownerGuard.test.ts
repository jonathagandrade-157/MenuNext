import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// P1-02 — papéis OWNER/STAFF nas Server Actions.
//
// 1) Cobertura estática: TODA ação exportada precisa de um guarda de papel
//    declarado. Se alguém criar uma ação nova num arquivo administrativo sem
//    requireOwnerAction(), ou um arquivo novo sem classificá-lo aqui, o teste
//    falha — em vez de uma heurística de texto.
// 2) Comportamento: STAFF não grava nada nas ações administrativas e continua
//    podendo ligar/desligar a disponibilidade de produto e adicional.
// O banco recusa de qualquer forma (RLS + triggers; ver supabase/tests/
// roles_owner_staff.sql): estas são a primeira camada, não a única.
// ---------------------------------------------------------------------------

const ACTIONS_DIR = path.resolve(__dirname);

/**
 * Arquivos em que TODA ação exige OWNER (requireOwnerAction). `exempt` lista as únicas exceções: as ações que o
 * STAFF pode usar (ligar/desligar disponibilidade) e as de onboarding que rodam ANTES de a loja existir.
 */
const OWNER_ONLY: Record<string, { exempt: string[] }> = {
  "addons.ts": { exempt: ["toggleAddonAvailableAction"] },
  "aparencia.ts": { exempt: [] },
  "categories.ts": { exempt: [] },
  "combos.ts": { exempt: [] },
  "configuracoes.ts": { exempt: [] },
  "coupons.ts": { exempt: [] },
  "delivery.ts": { exempt: [] },
  "deliveryZones.ts": { exempt: [] },
  "horarios.ts": { exempt: [] },
  "informacoes.ts": { exempt: [] },
  "onboarding.ts": { exempt: ["checkSlugAvailability", "savePasso1Action"] },
  "pagamentos.ts": { exempt: [] },
  "products.ts": { exempt: ["toggleProductAvailableAction"] },
  "promotions.ts": { exempt: [] },
};

/** Arquivos sem guarda de OWNER por escolha — cada um com o motivo. */
const OTHER_GUARDS: Record<string, string> = {
  "auth.ts": "login, cadastro e saída (sem loja)",
  "orders.ts": "operação de pedidos: STAFF avança e cancela; a RPC exige membro da loja do pedido",
  "cashSession.ts": "abrir/fechar caixa: STAFF opera; as RPCs cash_open/cash_close derivam a loja do usuário e exigem membro",
  "counterOrders.ts": "venda de balcão: STAFF registra; create_order exige membro da loja",
  "couponValidate.ts": "validação pública de cupom no checkout",
  "delivery-quote.ts": "cotação pública de entrega no checkout",
  "legalAcceptance.ts": "reaceite dos termos: cada usuário logado grava só o próprio aceite nos metadados",
  "invites.ts": "convites: requireOwner próprio e RPCs que exigem OWNER",
  "customerNotes.ts": "notas de clientes: checagem de OWNER própria e RLS só do OWNER",
  "master.ts": "ações do Master: is_platform_admin",
  "passwordReset.ts": "recuperação de senha: pedir o link é público (resposta igual exista a conta ou não); trocar a senha exige a sessão do link e o cookie de redefinição",
  "promotionPreview.ts": "prévia pública da promoção no checkout: preview_promotion só lê e não revela nada além do desconto",
  "pendingPayment.ts": "retomar pagamento: billing_pending_subscription só devolve a assinatura pendente do OWNER da loja",
  "plans.ts": "planos: is_platform_admin",
  "subscription.ts": "assinatura: a RPC billing/start_restaurant_subscription exige OWNER",
};

function actionFiles(): string[] {
  return fs
    .readdirSync(ACTIONS_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .sort();
}

function exportedActions(source: string): { name: string; body: string }[] {
  const parts = source.split(/^(?=export async function )/m).slice(1);
  return parts.map((body) => ({ name: /^export async function (\w+)/.exec(body)![1], body }));
}

describe("cobertura de papéis nas Server Actions", () => {
  it("todo arquivo de actions está classificado (OWNER ou outro guarda declarado)", () => {
    const known = new Set([...Object.keys(OWNER_ONLY), ...Object.keys(OTHER_GUARDS)]);
    const unclassified = actionFiles().filter((f) => !known.has(f));
    expect(unclassified, `arquivos novos precisam ser classificados em ownerGuard.test.ts: ${unclassified.join(", ")}`).toEqual([]);
    const missing = [...known].filter((f) => !actionFiles().includes(f));
    expect(missing, "arquivos listados que nao existem mais").toEqual([]);
  });

  for (const [file, { exempt }] of Object.entries(OWNER_ONLY)) {
    it(`${file}: cada ação exige OWNER, exceto as liberadas ao STAFF`, () => {
      const source = fs.readFileSync(path.join(ACTIONS_DIR, file), "utf8");
      const actions = exportedActions(source);
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        if (exempt.includes(action.name)) continue;
        expect(action.body, `${file}:${action.name} nao chama requireOwnerAction()`).toContain("requireOwnerAction(");
      }
      // as liberadas ao STAFF existem e NAO escrevem em nada alem do que a regra permite
      for (const name of exempt) {
        expect(actions.map((a) => a.name), `${file} deveria exportar ${name}`).toContain(name);
      }
      // nenhum auxiliar local volta a exigir so "membro" em ação administrativa
      const helper = /async function requireRestaurant\(\)/.test(source);
      if (exempt.length === 0) expect(helper, `${file}: auxiliar local requireRestaurant() de nivel membro`).toBe(false);
    });
  }

  it("as ações liberadas ao STAFF só mudam is_available", () => {
    const products = fs.readFileSync(path.join(ACTIONS_DIR, "products.ts"), "utf8");
    const toggle = exportedActions(products).find((a) => a.name === "toggleProductAvailableAction")!;
    expect(toggle.body).toMatch(/\.update\(\{ is_available: nextAvailable \}\)/);
    const addons = fs.readFileSync(path.join(ACTIONS_DIR, "addons.ts"), "utf8");
    const toggleAddon = exportedActions(addons).find((a) => a.name === "toggleAddonAvailableAction")!;
    expect(toggleAddon.body).toMatch(/\.update\(\{ is_available: nextAvailable \}\)/);
  });
});

// ---------------------------------------------------------------------------
// Comportamento
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => ({
  role: { value: "STAFF" as "OWNER" | "STAFF" },
  writes: [] as { table: string; op: string; values?: unknown }[],
  rpcCalls: [] as string[],
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: h.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const restaurant = {
      id: "r1", name: "Loja", slug: "loja", status: "active", onboarding_completed: true, onboarding_step: 7,
      payment_pix: true, payment_pix_key: "pix@loja.test",
    };
    const make = (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      for (const m of ["select", "eq", "in", "order", "limit", "neq"]) chain[m] = self;
      chain.maybeSingle = async () => ({
        data: table === "restaurants" ? restaurant : table === "restaurant_members" ? { role: h.role.value } : null,
        error: null,
      });
      chain.single = chain.maybeSingle;
      chain.update = (values: unknown) => { h.writes.push({ table, op: "update", values }); return chain; };
      chain.insert = (values: unknown) => { h.writes.push({ table, op: "insert", values }); return chain; };
      chain.delete = () => { h.writes.push({ table, op: "delete" }); return chain; };
      chain.upsert = (values: unknown) => { h.writes.push({ table, op: "upsert", values }); return chain; };
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [{ id: "x" }], error: null });
      return chain;
    };
    return {
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
      from: (table: string) => make(table),
      rpc: async (name: string) => { h.rpcCalls.push(name); return { data: null, error: null }; },
      storage: { from: () => ({ remove: async () => ({ error: null }), upload: async () => ({ error: null }) }) },
    };
  },
}));

import { toggleRestaurantStatusAction, saveContactInfoAction } from "./configuracoes";
import { savePagamentosConfigAction } from "./pagamentos";
import { deleteProductAction, moveProductAction, toggleProductAvailableAction } from "./products";
import { deleteAddonGroupAction, moveAddonAction, toggleAddonAvailableAction, toggleAddonGroupActiveAction } from "./addons";
import { createCategoryAction, deleteCategoryAction } from "./categories";
import { deleteCouponAction, toggleCouponActiveAction } from "./coupons";

function form(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("Server Actions administrativas como STAFF", () => {
  beforeEach(() => {
    h.role.value = "STAFF";
    h.writes.length = 0;
    h.rpcCalls.length = 0;
    h.redirect.mockClear();
  });

  const attempts: [string, () => Promise<unknown>][] = [
    ["pausar a loja", () => toggleRestaurantStatusAction("paused")],
    ["salvar contato", () => saveContactInfoAction({ status: "idle" } as never, form({ bio: "x" }))],
    ["trocar a chave Pix", () => savePagamentosConfigAction({ status: "idle" } as never, form({ payment_pix: "on", payment_pix_key: "hack", payment_pix_holder_name: "h", payment_pix_city: "c", payment_pix_key_type: "email" }))],
    ["excluir produto", () => deleteProductAction("p1")],
    ["reordenar produto", () => moveProductAction("p1", "up")],
    ["excluir grupo de adicionais", () => deleteAddonGroupAction("g1")],
    ["ativar/desativar grupo de adicionais", () => toggleAddonGroupActiveAction("g1", false)],
    ["reordenar adicional", () => moveAddonAction("a1", "up")],
    ["criar categoria", () => createCategoryAction({ status: "idle" } as never, form({ name: "hack" }))],
    ["excluir categoria", () => deleteCategoryAction("c1")],
    ["ativar/desativar cupom", () => toggleCouponActiveAction("k1", false)],
    ["excluir cupom", () => deleteCouponAction("k1")],
  ];

  for (const [label, run] of attempts) {
    it(`STAFF NÃO consegue ${label}: redireciona e não grava nada`, async () => {
      await expect(run()).rejects.toThrow("REDIRECT:/painel");
      expect(h.writes, "nenhuma escrita").toEqual([]);
      expect(h.rpcCalls, "nenhuma RPC").toEqual([]);
    });
  }

  it("STAFF continua ligando/desligando a disponibilidade do produto, mudando só is_available", async () => {
    const result = await toggleProductAvailableAction("p1", false);
    expect(result).toEqual({ ok: true });
    expect(h.writes).toEqual([{ table: "products", op: "update", values: { is_available: false } }]);
  });

  it("STAFF continua ligando/desligando a disponibilidade do adicional, mudando só is_available", async () => {
    const result = await toggleAddonAvailableAction("a1", true);
    expect(result).toEqual({ ok: true });
    expect(h.writes).toEqual([{ table: "addons", op: "update", values: { is_available: true } }]);
  });

  it("OWNER segue podendo pausar a loja e reordenar produtos", async () => {
    h.role.value = "OWNER";
    expect(await toggleRestaurantStatusAction("paused")).toEqual({ ok: true });
    expect(h.writes).toEqual([{ table: "restaurants", op: "update", values: { status: "paused" } }]);
    expect(await moveProductAction("p1", "up")).toEqual({ ok: true });
    expect(h.rpcCalls).toEqual(["move_product"]);
  });
});
