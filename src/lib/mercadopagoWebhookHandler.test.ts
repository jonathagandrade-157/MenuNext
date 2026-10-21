import { describe, expect, it, vi } from "vitest";
import { handleMercadoPagoWebhook, type MercadoPagoWebhookDeps, type MercadoPagoWebhookRequest } from "./mercadopagoWebhookHandler";
import type { MercadoPagoAuthorizedPayment, MercadoPagoPreapproval, MercadoPagoResult } from "./mercadopago";
import { buildMercadoPagoManifest, computeMercadoPagoSignature } from "./mercadopagoWebhook";

const SECRET = "segredo-mp-de-teste";
const REF = "11111111-1111-4111-8111-111111111111";
const PRE = "2c93808472aaaaaa0000000000000001";

const preapproval = (extra: Partial<MercadoPagoPreapproval> = {}): MercadoPagoPreapproval => ({
  id: PRE,
  status: "authorized",
  external_reference: REF,
  auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 49.9, currency_id: "BRL" },
  ...extra,
});

const invoice = (extra: Partial<MercadoPagoAuthorizedPayment> = {}): MercadoPagoAuthorizedPayment => ({
  id: 7001,
  preapproval_id: PRE,
  status: "processed",
  transaction_amount: 49.9,
  debit_date: "2026-10-10T12:00:00.000-03:00",
  payment: { id: 555, status: "approved" },
  ...extra,
});

type RequestOverrides = Omit<Partial<MercadoPagoWebhookRequest>, "dataId"> & { dataId?: string; body?: unknown };

function signedRequest(over: RequestOverrides = {}): MercadoPagoWebhookRequest {
  const dataId = over.dataId ?? PRE;
  const requestId = over.xRequestId ?? "req-1";
  const ts = "1700000000000";
  const v1 = computeMercadoPagoSignature(SECRET, buildMercadoPagoManifest({ dataId, requestId, ts }));
  return {
    xSignature: `ts=${ts},v1=${v1}`,
    xRequestId: requestId,
    dataId,
    topic: "subscription_preapproval",
    readBody: async () => over.body ?? { id: 99001, type: "subscription_preapproval", action: "updated", data: { id: dataId } },
    ...over,
  };
}

function makeDeps(opts: {
  secret?: string | undefined;
  apiConfigured?: boolean;
  preapproval?: MercadoPagoResult<MercadoPagoPreapproval>;
  invoice?: MercadoPagoResult<MercadoPagoAuthorizedPayment>;
  rpcResult?: { data?: unknown; error?: { message: string } | null };
} = {}) {
  const rpc = vi.fn<MercadoPagoWebhookDeps["rpc"]>(async () => ({
    data: opts.rpcResult?.data ?? "applied",
    error: opts.rpcResult?.error ?? null,
  }));
  const getPreapproval = vi.fn(async () => opts.preapproval ?? ({ ok: true, data: preapproval() } as MercadoPagoResult<MercadoPagoPreapproval>));
  const getAuthorizedPayment = vi.fn(
    async () => opts.invoice ?? ({ ok: true, data: invoice() } as MercadoPagoResult<MercadoPagoAuthorizedPayment>)
  );
  const deps: MercadoPagoWebhookDeps = {
    rpc,
    getPreapproval,
    getAuthorizedPayment,
    secret: "secret" in opts ? opts.secret : SECRET,
    apiConfigured: opts.apiConfigured ?? true,
  };
  return { deps, rpc, getPreapproval, getAuthorizedPayment };
}

const invoiceRequest = (extra: RequestOverrides = {}) =>
  signedRequest({
    dataId: "7001",
    topic: "subscription_authorized_payment",
    body: { id: 99002, type: "subscription_authorized_payment", action: "updated", data: { id: "7001" } },
    ...extra,
  });

describe("autenticação (assinatura HMAC)", () => {
  it("sem segredo configurado: 503 e nada é lido, consultado ou gravado", async () => {
    const { deps, rpc, getPreapproval } = makeDeps({ secret: undefined });
    const readBody = vi.fn(async () => ({}));
    const res = await handleMercadoPagoWebhook(signedRequest({ readBody }), deps);
    expect(res).toEqual({ status: 503, body: { error: "not_configured" } });
    expect(readBody).not.toHaveBeenCalled();
    expect(getPreapproval).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sem assinatura, malformada ou de outro segredo: 401 antes de ler o corpo, chamar a API ou gravar", async () => {
    const { deps, rpc, getPreapproval, getAuthorizedPayment } = makeDeps();
    const readBody = vi.fn(async () => ({}));
    const forged = computeMercadoPagoSignature("outro-segredo", buildMercadoPagoManifest({ dataId: PRE, requestId: "req-1", ts: "1700000000000" }));
    for (const xSignature of [null, "", "lixo", `ts=1700000000000,v1=${forged}`]) {
      const res = await handleMercadoPagoWebhook(signedRequest({ xSignature, readBody }), deps);
      expect(res).toEqual({ status: 401, body: { error: "not_authorized" } });
    }
    expect(readBody).not.toHaveBeenCalled();
    expect(getPreapproval).not.toHaveBeenCalled();
    expect(getAuthorizedPayment).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("assinatura de OUTRO recurso (data.id da query diferente) é recusada", async () => {
    const { deps, rpc } = makeDeps();
    const good = signedRequest({ dataId: PRE });
    const res = await handleMercadoPagoWebhook({ ...good, dataId: "2c93808472aaaaaa0000000000000002" }, deps);
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("assinatura de outro x-request-id é recusada", async () => {
    const { deps, rpc } = makeDeps();
    const res = await handleMercadoPagoWebhook({ ...signedRequest(), xRequestId: "req-adulterado" }, deps);
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("corpo e eventos que não interessam", () => {
  it("corpo ilegível: 400", async () => {
    const { deps, rpc } = makeDeps();
    const res = await handleMercadoPagoWebhook(
      signedRequest({
        readBody: async () => {
          throw new Error("json inválido");
        },
      }),
      deps
    );
    expect(res).toEqual({ status: 400, body: { error: "invalid_payload" } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("tópico que não é de assinatura (ex.: payment) é reconhecido e ignorado, sem consultar a API", async () => {
    const { deps, rpc, getPreapproval } = makeDeps();
    const res = await handleMercadoPagoWebhook(
      signedRequest({ topic: "payment", body: { id: 1, type: "payment", data: { id: PRE } } }),
      deps
    );
    expect(res).toEqual({ status: 200, body: { ok: true, ignored: true } });
    expect(getPreapproval).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("corpo que contradiz o id assinado da query é ignorado", async () => {
    const { deps, rpc, getPreapproval } = makeDeps();
    const res = await handleMercadoPagoWebhook(
      signedRequest({ body: { id: 1, type: "subscription_preapproval", data: { id: "OUTRO" } } }),
      deps
    );
    expect(res).toEqual({ status: 200, body: { ok: true, ignored: true } });
    expect(getPreapproval).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sem o token da API: nada é aplicado (unverified), a reconciliação recupera depois", async () => {
    const { deps, rpc, getPreapproval } = makeDeps({ apiConfigured: false });
    const res = await handleMercadoPagoWebhook(signedRequest(), deps);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ result: "unverified", reason: "cannot_verify" });
    expect(getPreapproval).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("evento de assinatura (preapproval)", () => {
  it("relê a assinatura na API e envia ao banco o que a API disse (não o corpo)", async () => {
    const { deps, rpc, getPreapproval } = makeDeps({ preapproval: { ok: true, data: preapproval({ status: "cancelled" }) } });
    const res = await handleMercadoPagoWebhook(
      signedRequest({ body: { id: 99001, type: "subscription_preapproval", action: "updated", status: "authorized", data: { id: PRE } } }),
      deps
    );
    expect(res).toEqual({ status: 200, body: { ok: true, result: "applied" } });
    expect(getPreapproval).toHaveBeenCalledWith(PRE);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("process_mercadopago_event", {
      p_event_id: "mp:99001",
      p_event_kind: "preapproval",
      p_occurred_at: null,
      p_subscription_ref: PRE,
      p_customer_ref: REF,
      p_external_ref: REF,
      p_subscription_status: "cancelled",
      p_payment_ref: null,
      p_payment_status: null,
      p_amount: null,
      p_due_date: null,
      p_paid_at: null,
    });
  });

  it("usa o date_created da notificação como horário do evento quando válido", async () => {
    const { deps, rpc } = makeDeps();
    await handleMercadoPagoWebhook(
      signedRequest({ body: { id: 1, type: "subscription_preapproval", date_created: "2026-10-10T12:00:00.000-03:00", data: { id: PRE } } }),
      deps
    );
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_occurred_at: "2026-10-10T15:00:00.000Z" });
    rpc.mockClear();
    await handleMercadoPagoWebhook(
      signedRequest({ body: { id: 2, type: "subscription_preapproval", date_created: "ontem", data: { id: PRE } } }),
      deps
    );
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_occurred_at: null });
  });

  it("assinatura relida com id diferente ou sem a referência do MenuNext: nada é aplicado", async () => {
    for (const data of [preapproval({ id: "2c93808472aaaaaa0000000000000009" }), preapproval({ external_reference: null }), preapproval({ external_reference: "" })]) {
      const { deps, rpc } = makeDeps({ preapproval: { ok: true, data } });
      const res = await handleMercadoPagoWebhook(signedRequest(), deps);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ result: "unverified" });
      expect(rpc).not.toHaveBeenCalled();
    }
  });
});

describe("evento de cobrança (authorized_payment)", () => {
  it("fatura paga: relê fatura e assinatura, envia status combinado, valor e vencimento da API", async () => {
    const { deps, rpc, getAuthorizedPayment, getPreapproval } = makeDeps();
    const res = await handleMercadoPagoWebhook(
      invoiceRequest({ readBody: async () => ({ id: 99002, type: "subscription_authorized_payment", transaction_amount: 1, data: { id: "7001" } }) }),
      deps
    );
    expect(res).toEqual({ status: 200, body: { ok: true, result: "applied" } });
    expect(getAuthorizedPayment).toHaveBeenCalledWith("7001");
    expect(getPreapproval).toHaveBeenCalledWith(PRE);
    expect(rpc).toHaveBeenCalledWith("process_mercadopago_event", {
      p_event_id: "mp:99002",
      p_event_kind: "authorized_payment",
      p_occurred_at: null,
      p_subscription_ref: PRE,
      p_customer_ref: REF,
      p_external_ref: REF,
      p_subscription_status: null,
      p_payment_ref: "7001",
      p_payment_status: "processed/approved",
      p_amount: 49.9,
      p_due_date: "2026-10-10",
      p_paid_at: null,
    });
  });

  it("o valor do corpo é ignorado: vale o da API", async () => {
    const { deps, rpc } = makeDeps({ invoice: { ok: true, data: invoice({ transaction_amount: "5.00" }) } });
    await handleMercadoPagoWebhook(
      invoiceRequest({ readBody: async () => ({ id: 3, type: "subscription_authorized_payment", transaction_amount: 49.9, data: { id: "7001" } }) }),
      deps
    );
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_amount: 5 });
  });

  it("fatura ainda não paga (agendada) é repassada ao banco com o status real, sem pedir prova de pagamento", async () => {
    const { deps, rpc } = makeDeps({ invoice: { ok: true, data: invoice({ status: "scheduled", payment: null }) } });
    const res = await handleMercadoPagoWebhook(invoiceRequest(), deps);
    expect(res.status).toBe(200);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_payment_status: "scheduled/", p_payment_ref: "7001" });
  });

  it("a fatura é aplicada à assinatura a que ela pertence segundo a API (o banco confere o vínculo com a referência)", async () => {
    const { deps, rpc } = makeDeps({
      invoice: { ok: true, data: invoice({ preapproval_id: "2c93808472aaaaaa0000000000000777" }) },
      preapproval: { ok: true, data: preapproval({ id: "2c93808472aaaaaa0000000000000777" }) },
    });
    const res = await handleMercadoPagoWebhook(invoiceRequest(), deps);
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_subscription_ref: "2c93808472aaaaaa0000000000000777" });
  });

  it("id da fatura diferente do evento ou sem assinatura: nada é aplicado", async () => {
    for (const data of [invoice({ id: 1 }), invoice({ preapproval_id: "" })]) {
      const { deps, rpc } = makeDeps({ invoice: { ok: true, data } });
      const res = await handleMercadoPagoWebhook(invoiceRequest(), deps);
      expect(res.body).toMatchObject({ result: "unverified" });
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("fatura paga com valor inválido: nada é aplicado (sem inventar valor)", async () => {
    const { deps, rpc } = makeDeps({ invoice: { ok: true, data: invoice({ transaction_amount: "abc" }) } });
    const res = await handleMercadoPagoWebhook(invoiceRequest(), deps);
    expect(res.body).toMatchObject({ result: "unverified", reason: "invalid_value" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("referência do MenuNext ausente na assinatura: nada é aplicado", async () => {
    const { deps, rpc } = makeDeps({ preapproval: { ok: true, data: preapproval({ external_reference: undefined }) } });
    const res = await handleMercadoPagoWebhook(invoiceRequest(), deps);
    expect(res.body).toMatchObject({ result: "unverified", reason: "missing_reference" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("falhas da API e do banco", () => {
  it("API responde 404/403/400: não confirma e não insiste (200 unverified)", async () => {
    for (const httpStatus of [404, 403, 400]) {
      const { deps, rpc } = makeDeps({ preapproval: { ok: false, reason: "request_failed", httpStatus } });
      const res = await handleMercadoPagoWebhook(signedRequest(), deps);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ result: "unverified" });
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("API indisponível (5xx, 429, rede): 503 para o Mercado Pago reenviar, sem gravar", async () => {
    for (const result of [
      { ok: false as const, reason: "request_failed" as const, httpStatus: 500 },
      { ok: false as const, reason: "request_failed" as const, httpStatus: 429 },
      { ok: false as const, reason: "request_failed" as const },
    ]) {
      const { deps, rpc } = makeDeps({ preapproval: result });
      const res = await handleMercadoPagoWebhook(signedRequest(), deps);
      expect(res).toEqual({ status: 503, body: { error: "verification_unavailable" } });
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("falha ao ler a assinatura-mãe de uma fatura também é tratada (503 em 5xx)", async () => {
    const { deps, rpc } = makeDeps({ preapproval: { ok: false, reason: "request_failed", httpStatus: 502 } });
    const res = await handleMercadoPagoWebhook(invoiceRequest(), deps);
    expect(res.status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("banco: invalid_event vira 400; qualquer outro erro vira 500", async () => {
    const a = makeDeps({ rpcResult: { error: { message: "invalid_event" } } });
    expect((await handleMercadoPagoWebhook(signedRequest(), a.deps)).status).toBe(400);
    const b = makeDeps({ rpcResult: { error: { message: "boom" } } });
    expect((await handleMercadoPagoWebhook(signedRequest(), b.deps)).status).toBe(500);
  });

  it("devolve o resultado do banco (duplicate, unmatched...) com 200", async () => {
    const { deps } = makeDeps({ rpcResult: { data: "duplicate" } });
    expect(await handleMercadoPagoWebhook(signedRequest(), deps)).toEqual({ status: 200, body: { ok: true, result: "duplicate" } });
  });
});
