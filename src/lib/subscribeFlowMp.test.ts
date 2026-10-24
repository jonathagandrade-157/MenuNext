import { describe, expect, it, vi } from "vitest";
import { runMercadoPagoSubscribeFlow, type MpSubscribeDeps } from "./subscribeFlowMp";
import type { MercadoPagoPreapproval, MercadoPagoResult, MercadoPagoSearch } from "./mercadopago";

const INTERNAL = "11111111-1111-4111-8111-111111111111";
const PRE = "2c93808472aaaaaa0000000000000001";
const CHECKOUT = "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=2c93808472aaaaaa0000000000000001";
const BACK = "https://menunext-xi.vercel.app/painel/plano";

const begun = { data: [{ out_subscription_id: INTERNAL, out_amount: "49.90", out_plan_name: "Plano Pro" }], error: null };

const pre = (extra: Partial<MercadoPagoPreapproval> = {}): MercadoPagoPreapproval => ({
  id: PRE,
  status: "pending",
  external_reference: INTERNAL,
  init_point: CHECKOUT,
  auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 49.9, currency_id: "BRL" },
  ...extra,
});

const ok = <T,>(data: T): MercadoPagoResult<T> => ({ ok: true, data });
const fail = (httpStatus?: number): MercadoPagoResult<never> => ({ ok: false, reason: "request_failed", httpStatus });

function makeDeps(over: {
  begin?: { data: unknown; error: { message: string } | null };
  email?: string | null;
  search?: MercadoPagoResult<MercadoPagoSearch<MercadoPagoPreapproval>>;
  create?: MercadoPagoResult<MercadoPagoPreapproval>;
  get?: MercadoPagoResult<MercadoPagoPreapproval>;
  attachError?: { message: string } | null;
} = {}) {
  const beginSubscription = vi.fn(async () => over.begin ?? begun);
  const getPayerEmail = vi.fn(async () => (over.email === undefined ? "dono@loja.test" : over.email));
  const attachSubscription = vi.fn(async () => ({ error: over.attachError ?? null }));
  const searchByExternalReference = vi.fn(async () => over.search ?? ok({ results: [] }));
  const createPreapproval = vi.fn(async () => over.create ?? ok(pre()));
  const getPreapproval = vi.fn(async () => over.get ?? ok(pre()));
  const cancelPreapproval = vi.fn(async () => ok(pre({ status: "cancelled" })));
  const deps: MpSubscribeDeps = {
    beginSubscription,
    getPayerEmail,
    attachSubscription,
    backUrl: BACK,
    mp: { searchByExternalReference, createPreapproval, getPreapproval, cancelPreapproval },
  };
  return { deps, beginSubscription, getPayerEmail, attachSubscription, searchByExternalReference, createPreapproval, getPreapproval, cancelPreapproval };
}

describe("caminho feliz", () => {
  it("banco abre, MP cria com valor e referência do BANCO, servidor lê de volta, BACKEND registra e devolve o link", async () => {
    const t = makeDeps();
    const res = await runMercadoPagoSubscribeFlow("plano-1", t.deps);
    expect(res).toEqual({ status: "success", redirectUrl: CHECKOUT });
    expect(t.searchByExternalReference).toHaveBeenCalledWith(INTERNAL);
    expect(t.createPreapproval).toHaveBeenCalledWith({
      payerEmail: "dono@loja.test",
      amount: 49.9,
      reason: "MenuNext — plano Plano Pro",
      externalReference: INTERNAL,
      backUrl: BACK,
    });
    expect(t.getPreapproval).toHaveBeenCalledWith(PRE);
    expect(t.attachSubscription).toHaveBeenCalledWith({
      subscriptionId: INTERNAL,
      customerId: INTERNAL,
      providerSubscriptionId: PRE,
      verifiedAmount: 49.9,
    });
    expect(t.cancelPreapproval).not.toHaveBeenCalled();
  });

  it("o valor enviado ao MP e ao banco é o do plano devolvido pelo banco", async () => {
    const t = makeDeps({
      begin: { data: [{ out_subscription_id: INTERNAL, out_amount: 79.9, out_plan_name: "Plano Top" }], error: null },
      get: ok(pre({ auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 79.9, currency_id: "BRL" } })),
    });
    const res = await runMercadoPagoSubscribeFlow("qualquer-id-do-navegador", t.deps);
    expect(res.status).toBe("success");
    expect(t.createPreapproval).toHaveBeenCalledWith(expect.objectContaining({ amount: 79.9 }));
    expect(t.attachSubscription).toHaveBeenCalledWith(expect.objectContaining({ verifiedAmount: 79.9 }));
  });
});

describe("prova de origem", () => {
  it("leitura de volta com referência, valor, moeda, frequência ou status incorretos: não registra e cancela o que criou", async () => {
    const bad: Partial<MercadoPagoPreapproval>[] = [
      { external_reference: "outra-tentativa" },
      { external_reference: null },
      { status: "cancelled" },
      { status: "paused" },
      { auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 1, currency_id: "BRL" } },
      { auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 49.9, currency_id: "USD" } },
      { auto_recurring: { frequency: 12, frequency_type: "months", transaction_amount: 49.9, currency_id: "BRL" } },
      { id: "2c93808472aaaaaa0000000000000999" },
    ];
    for (const extra of bad) {
      const t = makeDeps({ get: ok(pre(extra)) });
      const res = await runMercadoPagoSubscribeFlow("plano-1", t.deps);
      expect(res.status).toBe("error");
      expect(t.attachSubscription).not.toHaveBeenCalled();
      expect(t.cancelPreapproval).toHaveBeenCalledWith(PRE);
    }
  });

  it("API indisponível na leitura de volta: não registra e desfaz", async () => {
    const t = makeDeps({ get: fail(503) });
    const res = await runMercadoPagoSubscribeFlow("plano-1", t.deps);
    expect(res.status).toBe("error");
    expect(t.attachSubscription).not.toHaveBeenCalled();
    expect(t.cancelPreapproval).toHaveBeenCalledWith(PRE);
  });

  it("link de pagamento ausente ou de outro domínio: não registra, cancela e não redireciona", async () => {
    for (const init_point of [undefined, null, "", "http://www.mercadopago.com.br/x", "https://mercadopago.com.evil.example/x", "https://evil.example/mercadopago.com"]) {
      const t = makeDeps({ get: ok(pre({ init_point: init_point as string | null | undefined })) });
      const res = await runMercadoPagoSubscribeFlow("plano-1", t.deps);
      expect(res.status).toBe("error");
      expect((res as { redirectUrl?: string }).redirectUrl).toBeUndefined();
      expect(t.attachSubscription).not.toHaveBeenCalled();
      expect(t.cancelPreapproval).toHaveBeenCalledWith(PRE);
    }
  });

  it("o backend recusa o registro (id já usado, por exemplo): cancela a assinatura criada e avisa", async () => {
    const t = makeDeps({ attachError: { message: "provider_reference_in_use" } });
    const res = await runMercadoPagoSubscribeFlow("plano-1", t.deps);
    expect(res.status).toBe("error");
    expect(t.cancelPreapproval).toHaveBeenCalledWith(PRE);
  });
});

describe("idempotência", () => {
  it("reencontra a assinatura da MESMA tentativa e não cria outra (sem cobrança em dobro)", async () => {
    const t = makeDeps({ search: ok({ results: [pre()] }) });
    const res = await runMercadoPagoSubscribeFlow("plano-1", t.deps);
    expect(res).toEqual({ status: "success", redirectUrl: CHECKOUT });
    expect(t.createPreapproval).not.toHaveBeenCalled();
    expect(t.getPayerEmail).not.toHaveBeenCalled();
    expect(t.attachSubscription).toHaveBeenCalledWith(expect.objectContaining({ providerSubscriptionId: PRE }));
    expect(t.cancelPreapproval).not.toHaveBeenCalled();
  });

  it("se o registro falha numa assinatura REENCONTRADA, ela não é cancelada (só o que esta chamada criou)", async () => {
    const t = makeDeps({ search: ok({ results: [pre()] }), attachError: { message: "boom" } });
    const res = await runMercadoPagoSubscribeFlow("plano-1", t.deps);
    expect(res.status).toBe("error");
    expect(t.cancelPreapproval).not.toHaveBeenCalled();
  });

  it("sobra de tentativa com OUTRO valor: cancela a antiga e cria a nova", async () => {
    const stale = pre({ id: "2c93808472aaaaaa0000000000000555", auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 10, currency_id: "BRL" } });
    const t = makeDeps({ search: ok({ results: [stale] }) });
    const res = await runMercadoPagoSubscribeFlow("plano-1", t.deps);
    expect(res.status).toBe("success");
    expect(t.cancelPreapproval).toHaveBeenCalledWith("2c93808472aaaaaa0000000000000555");
    expect(t.createPreapproval).toHaveBeenCalledTimes(1);
    expect(t.attachSubscription).toHaveBeenCalledWith(expect.objectContaining({ providerSubscriptionId: PRE }));
  });

  it("assinaturas canceladas ou pausadas da busca são ignoradas (não reaproveitadas nem canceladas de novo)", async () => {
    const t = makeDeps({ search: ok({ results: [pre({ status: "cancelled", id: "2c93808472aaaaaa0000000000000444" }), pre({ status: "paused", id: "2c93808472aaaaaa0000000000000445" })] }) });
    const res = await runMercadoPagoSubscribeFlow("plano-1", t.deps);
    expect(res.status).toBe("success");
    expect(t.createPreapproval).toHaveBeenCalledTimes(1);
    expect(t.cancelPreapproval).not.toHaveBeenCalled();
  });

  it("não consegue consultar o MP para reencontrar: NÃO cria às cegas (evita duplicar a cobrança)", async () => {
    const t = makeDeps({ search: fail(500) });
    const res = await runMercadoPagoSubscribeFlow("plano-1", t.deps);
    expect(res.status).toBe("error");
    expect(t.createPreapproval).not.toHaveBeenCalled();
    expect(t.attachSubscription).not.toHaveBeenCalled();
  });
});

describe("erros", () => {
  it("erros do banco ao abrir viram mensagens claras e nada é criado no MP", async () => {
    const cases: [string, RegExp][] = [
      ["already_subscribed", /já tem uma assinatura/],
      ["plan_not_found", /Plano não encontrado/],
      ["plan_not_billable", /Plano não encontrado/],
      ["not_authorized", /responsável/],
      ["invalid_provider", /forma de cobrança/],
      ["algo inesperado", /Não foi possível iniciar/],
    ];
    for (const [message, expected] of cases) {
      const t = makeDeps({ begin: { data: null, error: { message } } });
      const res = await runMercadoPagoSubscribeFlow("plano-1", t.deps);
      expect(res.status).toBe("error");
      expect((res as { message: string }).message).toMatch(expected);
      expect(t.searchByExternalReference).not.toHaveBeenCalled();
      expect(t.createPreapproval).not.toHaveBeenCalled();
      expect(t.attachSubscription).not.toHaveBeenCalled();
    }
  });

  it("resposta do banco sem id da assinatura: erro genérico", async () => {
    const t = makeDeps({ begin: { data: [], error: null } });
    expect((await runMercadoPagoSubscribeFlow("plano-1", t.deps)).status).toBe("error");
    expect(t.createPreapproval).not.toHaveBeenCalled();
  });

  it("sem e-mail do pagador: erro e nada é criado", async () => {
    const t = makeDeps({ email: null });
    const res = await runMercadoPagoSubscribeFlow("plano-1", t.deps);
    expect(res.status).toBe("error");
    expect(t.createPreapproval).not.toHaveBeenCalled();
    expect(t.attachSubscription).not.toHaveBeenCalled();
  });

  it("falha ao criar a assinatura no MP (ou resposta sem id): erro, sem registrar", async () => {
    for (const create of [fail(500), ok(pre({ id: "" })), { ok: true, data: undefined as unknown as MercadoPagoPreapproval }]) {
      const t = makeDeps({ create: create as MercadoPagoResult<MercadoPagoPreapproval> });
      const res = await runMercadoPagoSubscribeFlow("plano-1", t.deps);
      expect(res.status).toBe("error");
      expect(t.attachSubscription).not.toHaveBeenCalled();
      expect(t.getPreapproval).not.toHaveBeenCalled();
    }
  });
});
