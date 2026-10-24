import { describe, expect, it, vi } from "vitest";
import { handleAsaasWebhook, type WebhookDeps } from "./asaasWebhookHandler";
import type { AsaasPaymentDetail, AsaasResult } from "./asaas";

const TOKEN = "t".repeat(40);

const payment = (extra: Partial<AsaasPaymentDetail> = {}): AsaasPaymentDetail => ({
  id: "pay_1",
  customer: "cus_1",
  subscription: "sub_1",
  value: 49.9,
  status: "CONFIRMED",
  dueDate: "2026-10-10",
  paymentDate: "2026-10-09",
  deleted: false,
  ...extra,
});

const confirmed = (event = "PAYMENT_CONFIRMED", extra: Record<string, unknown> = {}) => ({
  id: "evt_1",
  event,
  dateCreated: "2026-10-09 15:30:00",
  payment: { id: "pay_1", customer: "cus_1", subscription: "sub_1", value: 1.0, dueDate: "2026-10-10", ...extra },
});

function makeDeps(opts: {
  tokenValid?: boolean | null;
  tokenError?: boolean;
  process?: { data?: unknown; error?: { message: string } | null };
  payment?: AsaasResult<AsaasPaymentDetail>;
  configured?: boolean;
} = {}) {
  const rpc = vi.fn(async (fn: string) => {
    if (fn === "billing_webhook_token_valid") {
      if (opts.tokenError) return { data: null, error: { message: "boom" } };
      return { data: opts.tokenValid === undefined ? true : opts.tokenValid, error: null };
    }
    return { data: opts.process?.data ?? "applied", error: opts.process?.error ?? null };
  });
  const getPayment = vi.fn(async () => opts.payment ?? ({ ok: true, data: payment() } as AsaasResult<AsaasPaymentDetail>));
  const deps: WebhookDeps = { rpc, getPayment, asaasConfigured: opts.configured ?? true };
  return { deps, rpc, getPayment };
}

const processCalls = (rpc: ReturnType<typeof makeDeps>["rpc"]) => rpc.mock.calls.filter(([fn]) => fn === "process_asaas_webhook");

describe("webhook — autenticação do header asaas-access-token", () => {
  it("sem token: 401 e nada é lido, consultado ou gravado", async () => {
    const { deps, rpc, getPayment } = makeDeps();
    const readBody = vi.fn(async () => confirmed());
    for (const token of [null, ""]) {
      const res = await handleAsaasWebhook(token, readBody, deps);
      expect(res.status).toBe(401);
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(readBody).not.toHaveBeenCalled();
    expect(getPayment).not.toHaveBeenCalled();
  });

  it("token errado: 401 antes de ler o payload, de chamar o Asaas ou de processar", async () => {
    const { deps, rpc, getPayment } = makeDeps({ tokenValid: false });
    const readBody = vi.fn(async () => confirmed());
    const res = await handleAsaasWebhook("errado", readBody, deps);
    expect(res).toEqual({ status: 401, body: { error: "not_authorized" } });
    expect(readBody).not.toHaveBeenCalled();
    expect(getPayment).not.toHaveBeenCalled();
    expect(processCalls(rpc)).toHaveLength(0);
  });

  it("resposta do banco que não seja exatamente true (nulo, texto) conta como token inválido", async () => {
    for (const tokenValid of [null, "true" as unknown as boolean]) {
      const { deps, rpc } = makeDeps({ tokenValid });
      const res = await handleAsaasWebhook(TOKEN, async () => confirmed(), deps);
      expect(res.status).toBe(401);
      expect(processCalls(rpc)).toHaveLength(0);
    }
  });

  it("falha ao validar o token: 500, nunca libera nada", async () => {
    const { deps, rpc } = makeDeps({ tokenError: true });
    const res = await handleAsaasWebhook(TOKEN, async () => confirmed(), deps);
    expect(res.status).toBe(500);
    expect(processCalls(rpc)).toHaveLength(0);
  });

  it("o corpo do 401/500 não vaza detalhe interno nem o token", async () => {
    const { deps } = makeDeps({ tokenValid: false });
    const res = await handleAsaasWebhook(TOKEN, async () => confirmed(), deps);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
  });
});

describe("webhook — payload", () => {
  it("JSON ilegível: 400", async () => {
    const { deps } = makeDeps();
    const res = await handleAsaasWebhook(TOKEN, async () => { throw new SyntaxError("x"); }, deps);
    expect(res).toEqual({ status: 400, body: { error: "invalid_payload" } });
  });

  it("evento que não interessa (visualização, atualização): 200 ignorado, sem processar", async () => {
    const { deps, rpc } = makeDeps();
    for (const event of ["PAYMENT_BANK_SLIP_VIEWED", "PAYMENT_UPDATED", "SUBSCRIPTION_CREATED"]) {
      const res = await handleAsaasWebhook(TOKEN, async () => confirmed(event), deps);
      expect(res).toEqual({ status: 200, body: { ok: true, ignored: true } });
    }
    expect(processCalls(rpc)).toHaveLength(0);
  });

  it("payload nulo ou sem id de evento: 200 ignorado", async () => {
    const { deps, rpc } = makeDeps();
    expect((await handleAsaasWebhook(TOKEN, async () => null, deps)).body).toEqual({ ok: true, ignored: true });
    expect((await handleAsaasWebhook(TOKEN, async () => ({ event: "PAYMENT_CONFIRMED" }), deps)).body).toEqual({ ok: true, ignored: true });
    expect(processCalls(rpc)).toHaveLength(0);
  });
});

describe("webhook — confirmação de pagamento só vale se a API do Asaas concordar", () => {
  it("evento VERDADEIRO: aplica com os valores lidos da API, não os do payload", async () => {
    const { deps, rpc, getPayment } = makeDeps();
    const res = await handleAsaasWebhook(TOKEN, async () => confirmed(), deps);
    expect(res).toEqual({ status: 200, body: { ok: true, result: "applied" } });
    expect(getPayment).toHaveBeenCalledWith("pay_1");
    const [, args] = processCalls(rpc)[0] as unknown as [string, Record<string, unknown>];
    expect(args).toMatchObject({
      p_webhook_token: TOKEN,
      p_event_id: "evt_1",
      p_event_type: "PAYMENT_CONFIRMED",
      p_subscription_id: "sub_1",
      p_customer_id: "cus_1",
      p_payment_id: "pay_1",
      p_value: 49.9, // valor da API; o payload dizia 1.0
      p_due_date: "2026-10-10",
      p_paid_at: "2026-10-09",
    });
  });

  it("PAYMENT_RECEIVED recebe o mesmo tratamento", async () => {
    const { deps, getPayment, rpc } = makeDeps({ payment: { ok: true, data: payment({ status: "RECEIVED" }) } });
    const res = await handleAsaasWebhook(TOKEN, async () => confirmed("PAYMENT_RECEIVED"), deps);
    expect(res.status).toBe(200);
    expect(getPayment).toHaveBeenCalledTimes(1);
    expect(processCalls(rpc)).toHaveLength(1);
  });

  it("evento FORJADO: a API diz que a cobrança segue pendente/atrasada/estornada -> não aplica", async () => {
    for (const status of ["PENDING", "OVERDUE", "REFUNDED", "CHARGEBACK_REQUESTED"]) {
      const { deps, rpc } = makeDeps({ payment: { ok: true, data: payment({ status }) } });
      const res = await handleAsaasWebhook(TOKEN, async () => confirmed(), deps);
      expect(res.body).toMatchObject({ ok: true, result: "unverified", reason: "payment_not_paid" });
      expect(processCalls(rpc)).toHaveLength(0);
    }
  });

  it("cobrança de OUTRA assinatura ou de OUTRO cliente na API -> não aplica", async () => {
    for (const extra of [{ subscription: "sub_2" }, { customer: "cus_2" }, { subscription: null }]) {
      const { deps, rpc } = makeDeps({ payment: { ok: true, data: payment(extra) } });
      const res = await handleAsaasWebhook(TOKEN, async () => confirmed(), deps);
      expect(res.body).toMatchObject({ result: "unverified" });
      expect(processCalls(rpc)).toHaveLength(0);
    }
  });

  it("cobrança que não existe no Asaas (404/403): 200 não verificado, sem insistir", async () => {
    for (const httpStatus of [404, 403, 401]) {
      const { deps, rpc } = makeDeps({ payment: { ok: false, reason: "request_failed", httpStatus } });
      const res = await handleAsaasWebhook(TOKEN, async () => confirmed(), deps);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ result: "unverified" });
      expect(processCalls(rpc)).toHaveLength(0);
    }
  });

  it("Asaas indisponível (rede, 5xx, 429): 503 para o Asaas reenviar; nada é aplicado", async () => {
    for (const failure of [
      { ok: false as const, reason: "request_failed" as const },
      { ok: false as const, reason: "request_failed" as const, httpStatus: 500 },
      { ok: false as const, reason: "request_failed" as const, httpStatus: 429 },
      { ok: false as const, reason: "invalid_response" as const, httpStatus: 502 },
    ]) {
      const { deps, rpc } = makeDeps({ payment: failure });
      const res = await handleAsaasWebhook(TOKEN, async () => confirmed(), deps);
      expect(res.status).toBe(503);
      expect(processCalls(rpc)).toHaveLength(0);
    }
  });

  it("sem a chave do Asaas (não dá para verificar): falha FECHADO, não libera", async () => {
    const { deps, rpc, getPayment } = makeDeps({ configured: false });
    const res = await handleAsaasWebhook(TOKEN, async () => confirmed(), deps);
    expect(res.body).toMatchObject({ result: "unverified", reason: "cannot_verify" });
    expect(getPayment).not.toHaveBeenCalled();
    expect(processCalls(rpc)).toHaveLength(0);
  });
});

describe("webhook — demais eventos seguem para o banco, que decide o efeito", () => {
  it("atraso, estorno, chargeback, exclusão e cancelamento são repassados sem consultar a API", async () => {
    for (const event of ["PAYMENT_OVERDUE", "PAYMENT_REFUNDED", "PAYMENT_CHARGEBACK_REQUESTED", "PAYMENT_DELETED", "PAYMENT_RESTORED", "PAYMENT_CREATED"]) {
      const { deps, rpc, getPayment } = makeDeps();
      const res = await handleAsaasWebhook(TOKEN, async () => confirmed(event), deps);
      expect(res.status).toBe(200);
      expect(getPayment).not.toHaveBeenCalled();
      expect(processCalls(rpc)).toHaveLength(1);
    }
    const { deps, rpc } = makeDeps();
    await handleAsaasWebhook(TOKEN, async () => ({ id: "evt_c", event: "SUBSCRIPTION_DELETED", subscription: { id: "sub_1", customer: "cus_1" } }), deps);
    const [, args] = processCalls(rpc)[0] as unknown as [string, Record<string, unknown>];
    expect(args).toMatchObject({ p_event_type: "SUBSCRIPTION_DELETED", p_subscription_id: "sub_1", p_customer_id: "cus_1", p_payment_id: null });
  });

  it("o resultado do banco (duplicate, stale, unmatched...) volta no corpo, sempre 200", async () => {
    for (const result of ["duplicate", "stale", "unmatched", "value_mismatch", "customer_mismatch"]) {
      const { deps } = makeDeps({ process: { data: result } });
      const res = await handleAsaasWebhook(TOKEN, async () => confirmed("PAYMENT_OVERDUE"), deps);
      expect(res).toEqual({ status: 200, body: { ok: true, result } });
    }
  });

  it("erros do banco: not_authorized -> 401, invalid_event -> 400, outros -> 500 sem vazar a mensagem", async () => {
    const cases: [string, number][] = [
      ["not_authorized", 401],
      ["invalid_event", 400],
      ["relation billing_payments is broken: secret detail", 500],
    ];
    for (const [message, status] of cases) {
      const { deps } = makeDeps({ process: { error: { message } } });
      const res = await handleAsaasWebhook(TOKEN, async () => confirmed("PAYMENT_OVERDUE"), deps);
      expect(res.status).toBe(status);
      expect(JSON.stringify(res.body)).not.toContain("secret detail");
    }
  });
});
