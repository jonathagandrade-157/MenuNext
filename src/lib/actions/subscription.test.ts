import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  configured: { value: true },
  mpConfigured: { value: false },
  mpSearch: vi.fn(),
  mpCreate: vi.fn(),
  mpGet: vi.fn(),
  mpCancel: vi.fn(),
  userRpc: vi.fn(),
  adminRpc: vi.fn(),
  createCustomer: vi.fn(),
  createSub: vi.fn(),
  deleteSub: vi.fn(),
  getSub: vi.fn(),
  listByRef: vi.fn(),
  revalidate: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: h.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "dono@loja.test" } } }) },
    rpc: h.userRpc,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "Dono", document: "52998224725" }, error: null }) }) }),
    }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: h.adminRpc }) }));
vi.mock("@/lib/tenant", () => ({ getMyRestaurant: async () => ({ id: "r1", name: "Loja" }) }));
vi.mock("@/lib/billingConfig", () => ({
  isBillingConfigured: () => h.configured.value,
  isMercadoPagoBillingConfigured: () => h.mpConfigured.value,
}));
vi.mock("@/lib/mercadopago", () => ({
  searchMercadoPagoPreapprovalsByExternalReference: h.mpSearch,
  createMercadoPagoPreapproval: h.mpCreate,
  getMercadoPagoPreapproval: h.mpGet,
  cancelMercadoPagoPreapproval: h.mpCancel,
}));
vi.mock("@/lib/site-url", () => ({ getRequestOrigin: async () => "https://menunext.test" }));
vi.mock("@/lib/asaas", () => ({
  createAsaasCustomer: h.createCustomer,
  createAsaasSubscription: h.createSub,
  deleteAsaasSubscription: h.deleteSub,
  getAsaasSubscription: h.getSub,
  listAsaasSubscriptionsByExternalReference: h.listByRef,
}));

import { subscribeToPlanAction } from "./subscription";

const INTERNAL = "11111111-1111-4111-8111-111111111111";
const begun = { data: [{ out_subscription_id: INTERNAL, out_amount: "49.90", out_plan_name: "Plano Pro" }], error: null };

const remote = (extra: Record<string, unknown> = {}) => ({
  ok: true,
  data: { id: "sub_new1", customer: "cus_new1", value: 49.9, status: "ACTIVE", externalReference: INTERNAL, deleted: false, ...extra },
});

beforeEach(() => {
  vi.clearAllMocks();
  h.configured.value = true;
  h.mpConfigured.value = false;
  h.userRpc.mockResolvedValue(begun);
  h.adminRpc.mockResolvedValue({ data: null, error: null });
  h.listByRef.mockResolvedValue({ ok: true, data: { data: [], hasMore: false } });
  h.createCustomer.mockResolvedValue({ ok: true, data: { id: "cus_new1" } });
  h.createSub.mockResolvedValue({ ok: true, data: { id: "sub_new1", status: "ACTIVE", nextDueDate: "2026-10-10" } });
  h.getSub.mockResolvedValue(remote());
  h.deleteSub.mockResolvedValue({ ok: true, data: { deleted: true } });
});

describe("subscribeToPlanAction — vínculo confiável", () => {
  it("sem a configuração de cobrança falha antes de qualquer chamada (nada é criado no Asaas)", async () => {
    h.configured.value = false;
    const res = await subscribeToPlanAction("plano-1");
    expect(res.status).toBe("error");
    expect(h.userRpc).not.toHaveBeenCalled();
    expect(h.createCustomer).not.toHaveBeenCalled();
    expect(h.createSub).not.toHaveBeenCalled();
  });

  it("caminho feliz: banco abre, Asaas cria com valor e referência do BANCO, servidor lê de volta e o BACKEND registra", async () => {
    const res = await subscribeToPlanAction("plano-1");
    expect(res).toEqual({ status: "success" });
    expect(h.userRpc).toHaveBeenCalledTimes(1);
    expect(h.userRpc).toHaveBeenCalledWith("billing_begin_subscription", { p_plan_id: "plano-1" });
    expect(h.createSub).toHaveBeenCalledWith(expect.objectContaining({ value: 49.9, externalReference: INTERNAL, customerId: "cus_new1" }));
    expect(h.getSub).toHaveBeenCalledWith("sub_new1");
    expect(h.adminRpc).toHaveBeenCalledWith("billing_attach_provider_subscription", {
      p_subscription_id: INTERNAL,
      p_provider_customer_id: "cus_new1",
      p_provider_subscription_id: "sub_new1",
      p_verified_amount: 49.9,
    });
    expect(h.deleteSub).not.toHaveBeenCalled();
    expect(h.revalidate).toHaveBeenCalled();
  });

  it("o registro dos ids NUNCA passa pelo cliente do lojista (só billing_begin_subscription)", async () => {
    await subscribeToPlanAction("plano-1");
    expect(h.userRpc.mock.calls.map((c) => c[0])).toEqual(["billing_begin_subscription"]);
    expect(h.adminRpc.mock.calls.map((c) => c[0])).toEqual(["billing_attach_provider_subscription"]);
  });

  it("o valor enviado ao Asaas e ao banco é o do plano devolvido pelo banco, não algo vindo do navegador", async () => {
    h.userRpc.mockResolvedValue({ data: [{ out_subscription_id: INTERNAL, out_amount: 79.9, out_plan_name: "Plano Top" }], error: null });
    h.getSub.mockResolvedValue(remote({ value: 79.9 }));
    await subscribeToPlanAction("qualquer-id-do-navegador");
    expect(h.createSub).toHaveBeenCalledWith(expect.objectContaining({ value: 79.9 }));
    expect(h.adminRpc.mock.calls[0][1]).toMatchObject({ p_verified_amount: 79.9 });
  });
});

describe("subscribeToPlanAction — prova de origem", () => {
  it("a leitura de volta mostra OUTRO cliente: não registra e remove o que acabou de criar", async () => {
    h.getSub.mockResolvedValue(remote({ customer: "cus_de_outro" }));
    const res = await subscribeToPlanAction("plano-1");
    expect(res.status).toBe("error");
    expect(h.adminRpc).not.toHaveBeenCalled();
    expect(h.deleteSub).toHaveBeenCalledWith("sub_new1");
  });

  it("referência diferente, valor diferente ou assinatura inativa: não registra", async () => {
    for (const extra of [{ externalReference: "outra-tentativa" }, { externalReference: null }, { value: 1 }, { status: "INACTIVE" }, { deleted: true }]) {
      vi.clearAllMocks();
      h.userRpc.mockResolvedValue(begun);
      h.listByRef.mockResolvedValue({ ok: true, data: { data: [], hasMore: false } });
      h.createCustomer.mockResolvedValue({ ok: true, data: { id: "cus_new1" } });
      h.createSub.mockResolvedValue({ ok: true, data: { id: "sub_new1", status: "ACTIVE", nextDueDate: "2026-10-10" } });
      h.deleteSub.mockResolvedValue({ ok: true, data: { deleted: true } });
      h.getSub.mockResolvedValue(remote(extra));
      const res = await subscribeToPlanAction("plano-1");
      expect(res.status).toBe("error");
      expect(h.adminRpc).not.toHaveBeenCalled();
      expect(h.deleteSub).toHaveBeenCalledWith("sub_new1");
    }
  });

  it("Asaas indisponível na leitura de volta: não registra e desfaz", async () => {
    h.getSub.mockResolvedValue({ ok: false, reason: "request_failed", httpStatus: 503 });
    const res = await subscribeToPlanAction("plano-1");
    expect(res.status).toBe("error");
    expect(h.adminRpc).not.toHaveBeenCalled();
    expect(h.deleteSub).toHaveBeenCalledWith("sub_new1");
  });

  it("o backend recusa o registro (por exemplo, id já usado): remove a assinatura criada e avisa", async () => {
    h.adminRpc.mockResolvedValue({ data: null, error: { message: "provider_reference_in_use" } });
    const res = await subscribeToPlanAction("plano-1");
    expect(res.status).toBe("error");
    expect(h.deleteSub).toHaveBeenCalledWith("sub_new1");
    expect(h.revalidate).not.toHaveBeenCalled();
  });
});

describe("subscribeToPlanAction — idempotência e erros", () => {
  it("reencontra a assinatura da MESMA tentativa e não cria outra (sem cobrança em dobro)", async () => {
    h.listByRef.mockResolvedValue({
      ok: true,
      data: { data: [{ id: "sub_old1", customer: "cus_old1", value: 49.9, status: "ACTIVE", externalReference: INTERNAL, deleted: false }], hasMore: false },
    });
    h.getSub.mockResolvedValue(remote({ id: "sub_old1", customer: "cus_old1" }));
    const res = await subscribeToPlanAction("plano-1");
    expect(res.status).toBe("success");
    expect(h.createCustomer).not.toHaveBeenCalled();
    expect(h.createSub).not.toHaveBeenCalled();
    expect(h.adminRpc).toHaveBeenCalledWith("billing_attach_provider_subscription", expect.objectContaining({ p_provider_subscription_id: "sub_old1", p_provider_customer_id: "cus_old1" }));
    expect(h.deleteSub).not.toHaveBeenCalled();
  });

  it("sobra de tentativa com OUTRO valor (plano mudou de preço): remove a antiga e cria a nova", async () => {
    h.listByRef.mockResolvedValue({
      ok: true,
      data: { data: [{ id: "sub_stale", customer: "cus_old1", value: 10, status: "ACTIVE", externalReference: INTERNAL, deleted: false }], hasMore: false },
    });
    const res = await subscribeToPlanAction("plano-1");
    expect(res.status).toBe("success");
    expect(h.deleteSub).toHaveBeenCalledWith("sub_stale");
    expect(h.createSub).toHaveBeenCalledTimes(1);
    expect(h.adminRpc.mock.calls[0][1]).toMatchObject({ p_provider_subscription_id: "sub_new1" });
  });

  it("não consegue consultar o Asaas para reencontrar: NÃO cria às cegas (evita duplicar a cobrança)", async () => {
    h.listByRef.mockResolvedValue({ ok: false, reason: "request_failed", httpStatus: 500 });
    const res = await subscribeToPlanAction("plano-1");
    expect(res.status).toBe("error");
    expect(h.createCustomer).not.toHaveBeenCalled();
    expect(h.createSub).not.toHaveBeenCalled();
    expect(h.adminRpc).not.toHaveBeenCalled();
  });

  it("erros do banco ao abrir viram mensagens claras e nada é criado no Asaas", async () => {
    const cases: [string, RegExp][] = [
      ["already_subscribed", /já tem uma assinatura/],
      ["plan_not_found", /Plano não encontrado/],
      ["plan_not_billable", /Plano não encontrado/],
      ["not_authorized", /responsável/],
      ["algo inesperado", /Não foi possível iniciar/],
    ];
    for (const [message, expected] of cases) {
      vi.clearAllMocks();
      h.userRpc.mockResolvedValue({ data: null, error: { message } });
      const res = await subscribeToPlanAction("plano-1");
      expect(res.status).toBe("error");
      expect((res as { message: string }).message).toMatch(expected);
      expect(h.createSub).not.toHaveBeenCalled();
      expect(h.adminRpc).not.toHaveBeenCalled();
    }
  });

  it("falha ao criar cliente ou assinatura no Asaas: erro, sem registrar", async () => {
    h.createCustomer.mockResolvedValue({ ok: false, reason: "request_failed" });
    expect((await subscribeToPlanAction("plano-1")).status).toBe("error");
    h.createCustomer.mockResolvedValue({ ok: true, data: { id: "cus_new1" } });
    h.createSub.mockResolvedValue({ ok: false, reason: "request_failed" });
    expect((await subscribeToPlanAction("plano-1")).status).toBe("error");
    expect(h.adminRpc).not.toHaveBeenCalled();
  });
});

describe("subscribeToPlanAction — o provedor é escolhido pelo banco (Master), não pelo navegador", () => {
  const PRE = "2c93808472aaaaaa0000000000000001";
  const CHECKOUT = "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=2c93808472aaaaaa0000000000000001";
  const mpPre = (extra: Record<string, unknown> = {}) => ({
    id: PRE,
    status: "pending",
    external_reference: INTERNAL,
    init_point: CHECKOUT,
    auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 49.9, currency_id: "BRL" },
    ...extra,
  });
  const begunMp = {
    data: [{ out_subscription_id: INTERNAL, out_amount: "49.90", out_plan_name: "Plano Pro", out_provider: "mercadopago" }],
    error: null,
  };

  beforeEach(() => {
    h.configured.value = true;
    h.mpConfigured.value = true;
    h.mpSearch.mockResolvedValue({ ok: true, data: { results: [] } });
    h.mpCreate.mockResolvedValue({ ok: true, data: mpPre() });
    h.mpGet.mockResolvedValue({ ok: true, data: mpPre() });
    h.mpCancel.mockResolvedValue({ ok: true, data: mpPre({ status: "cancelled" }) });
  });

  it("banco devolve mercadopago: segue o fluxo do Mercado Pago, devolve o link e NÃO toca no Asaas", async () => {
    h.userRpc.mockResolvedValue(begunMp);
    const res = await subscribeToPlanAction("plano-1");
    expect(res).toEqual({ status: "success", redirectUrl: CHECKOUT });
    expect(h.userRpc).toHaveBeenCalledTimes(1);
    expect(h.userRpc).toHaveBeenCalledWith("billing_begin_subscription", { p_plan_id: "plano-1" });
    expect(h.mpCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 49.9, externalReference: INTERNAL, payerEmail: "dono@loja.test", backUrl: "https://menunext.test/painel/plano" })
    );
    expect(h.adminRpc).toHaveBeenCalledWith("billing_attach_provider_subscription", {
      p_subscription_id: INTERNAL,
      p_provider_customer_id: INTERNAL,
      p_provider_subscription_id: PRE,
      p_verified_amount: 49.9,
    });
    expect(h.createCustomer).not.toHaveBeenCalled();
    expect(h.createSub).not.toHaveBeenCalled();
    expect(h.listByRef).not.toHaveBeenCalled();
    expect(h.revalidate).toHaveBeenCalled();
  });

  it("o navegador não escolhe o provedor: a ação só envia o id do plano ao banco", async () => {
    h.userRpc.mockResolvedValue(begunMp);
    await subscribeToPlanAction("plano-1");
    expect(h.userRpc.mock.calls.map((c) => c[1])).toEqual([{ p_plan_id: "plano-1" }]);
    expect(h.userRpc.mock.calls.map((c) => c[0])).toEqual(["billing_begin_subscription"]);
    expect(h.adminRpc.mock.calls.map((c) => c[0])).toEqual(["billing_attach_provider_subscription"]);
  });

  it("sem out_provider na resposta (banco antigo) segue o Asaas, como antes", async () => {
    const res = await subscribeToPlanAction("plano-1");
    expect(res).toEqual({ status: "success" });
    expect(h.mpCreate).not.toHaveBeenCalled();
    expect(h.createSub).toHaveBeenCalledTimes(1);
  });

  it("provedor escolhido é o Mercado Pago mas ele não está configurado: erro, nada é criado nem registrado", async () => {
    h.userRpc.mockResolvedValue(begunMp);
    h.mpConfigured.value = false;
    const res = await subscribeToPlanAction("plano-1");
    expect(res.status).toBe("error");
    expect(h.mpCreate).not.toHaveBeenCalled();
    expect(h.createSub).not.toHaveBeenCalled();
    expect(h.adminRpc).not.toHaveBeenCalled();
  });

  it("provedor escolhido é o Asaas mas só o Mercado Pago está configurado: erro, nada é criado", async () => {
    h.configured.value = false;
    const res = await subscribeToPlanAction("plano-1");
    expect(res.status).toBe("error");
    expect(h.mpCreate).not.toHaveBeenCalled();
    expect(h.createSub).not.toHaveBeenCalled();
    expect(h.adminRpc).not.toHaveBeenCalled();
  });

  it("nenhum provedor configurado: falha antes de qualquer chamada", async () => {
    h.configured.value = false;
    h.mpConfigured.value = false;
    const res = await subscribeToPlanAction("plano-1");
    expect(res.status).toBe("error");
    expect(h.userRpc).not.toHaveBeenCalled();
  });

  it("falha na prova de origem do Mercado Pago: não registra, cancela e não devolve link", async () => {
    h.userRpc.mockResolvedValue(begunMp);
    h.mpGet.mockResolvedValue({ ok: true, data: mpPre({ external_reference: "outra" }) });
    const res = await subscribeToPlanAction("plano-1");
    expect(res.status).toBe("error");
    expect((res as { redirectUrl?: string }).redirectUrl).toBeUndefined();
    expect(h.adminRpc).not.toHaveBeenCalled();
    expect(h.mpCancel).toHaveBeenCalledWith(PRE);
    expect(h.revalidate).not.toHaveBeenCalled();
  });
});
