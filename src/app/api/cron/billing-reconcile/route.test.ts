import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  adminConfigured: { value: true },
  asaasConfigured: { value: true },
  getSubscription: vi.fn(),
  listPayments: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: h.adminRpc }),
  isAdminConfigured: () => h.adminConfigured.value,
}));
vi.mock("@/lib/asaas", () => ({
  isAsaasConfigured: () => h.asaasConfigured.value,
  getAsaasSubscription: h.getSubscription,
  listAsaasSubscriptionPayments: h.listPayments,
}));

import { GET } from "./route";

const SECRET = "cron-secret-com-mais-de-16";
const call = (authorization?: string) =>
  GET(new Request("https://menunext.test/api/cron/billing-reconcile", { headers: authorization ? { authorization } : {} }));

const row = { out_provider: "asaas", out_subscription_ref: "sub_1", out_customer_ref: "cus_1" };

const original = process.env.CRON_SECRET;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  h.adminConfigured.value = true;
  h.asaasConfigured.value = true;
  h.adminRpc.mockImplementation(async (fn: string) => {
    if (fn === "billing_list_reconcilable") return { data: [row], error: null };
    return { data: "applied", error: null };
  });
  h.getSubscription.mockResolvedValue({ ok: true, data: { id: "sub_1", customer: "cus_1", value: 49.9, status: "ACTIVE", externalReference: "r", deleted: false } });
  h.listPayments.mockResolvedValue({ ok: true, data: { data: [], hasMore: false } });
});
afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
});

describe("GET /api/cron/billing-reconcile — proteção da rota", () => {
  it("sem CRON_SECRET (ou curto demais) falha FECHADO, mesmo com cabeçalho", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer qualquer")).status).toBe(503);
    process.env.CRON_SECRET = "curto";
    expect((await call("Bearer curto")).status).toBe(503);
    expect(h.adminRpc).not.toHaveBeenCalled();
  });

  it("sem cabeçalho, com segredo errado ou em outro formato: 401 e nada é executado", async () => {
    for (const header of [undefined, "Bearer errado", SECRET, `bearer ${SECRET}`, `Bearer ${SECRET}x`, "Bearer "]) {
      expect((await call(header)).status).toBe(401);
    }
    expect(h.adminRpc).not.toHaveBeenCalled();
    expect(h.getSubscription).not.toHaveBeenCalled();
  });

  it("sem a chave do Asaas ou a chave de servidor do Supabase: 503", async () => {
    h.asaasConfigured.value = false;
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
    h.asaasConfigured.value = true;
    h.adminConfigured.value = false;
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
    expect(h.adminRpc).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/billing-reconcile — execução", () => {
  it("com o segredo certo lista, reconcilia e devolve só contagens", async () => {
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, checked: 1 });
    expect(Object.keys(body).sort()).toEqual(["applied", "checked", "errors", "notFound", "ok", "unavailable"]);
    expect(h.adminRpc).toHaveBeenCalledWith("billing_list_reconcilable", { p_limit: 40 });
    expect(JSON.stringify(body)).not.toContain("sub_1");
  });

  it("falha ao listar: 500 sem detalhes", async () => {
    h.adminRpc.mockResolvedValue({ data: null, error: { message: "detalhe interno" } });
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("detalhe interno");
  });

  it("Asaas fora do ar: 200 contando indisponíveis, sem alterar nada", async () => {
    h.getSubscription.mockResolvedValue({ ok: false, reason: "request_failed", httpStatus: 503 });
    const body = await (await call(`Bearer ${SECRET}`)).json();
    expect(body).toMatchObject({ checked: 1, unavailable: 1, applied: 0 });
    expect(h.adminRpc.mock.calls.filter(([fn]) => fn !== "billing_list_reconcilable")).toHaveLength(0);
  });
});
