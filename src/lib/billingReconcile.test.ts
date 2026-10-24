import { describe, expect, it, vi } from "vitest";
import { reconcileBatch, reconcileSubscription, type ReconcileDeps, type ReconcilableRow } from "./billingReconcile";
import type { AsaasList, AsaasPaymentDetail, AsaasResult, AsaasSubscriptionDetail } from "./asaas";

const row: ReconcilableRow = { out_provider: "asaas", out_subscription_ref: "sub_1", out_customer_ref: "cus_1" };

const remoteSub = (extra: Partial<AsaasSubscriptionDetail> = {}): AsaasResult<AsaasSubscriptionDetail> => ({
  ok: true,
  data: { id: "sub_1", customer: "cus_1", value: 49.9, status: "ACTIVE", externalReference: "ref", deleted: false, ...extra },
});

const pay = (id: string, status: string, extra: Partial<AsaasPaymentDetail> = {}): AsaasPaymentDetail => ({
  id,
  customer: "cus_1",
  subscription: "sub_1",
  value: 49.9,
  status,
  dueDate: "2026-10-10",
  paymentDate: null,
  deleted: false,
  ...extra,
});

const page = (data: AsaasPaymentDetail[], hasMore = false): AsaasResult<AsaasList<AsaasPaymentDetail>> => ({
  ok: true,
  data: { data, hasMore },
});

function deps(opts: {
  sub?: AsaasResult<AsaasSubscriptionDetail>;
  pages?: AsaasResult<AsaasList<AsaasPaymentDetail>>[];
  rpcResult?: (fn: string, args: Record<string, unknown>) => { data?: unknown; error?: { message: string } | null };
} = {}) {
  const pages = opts.pages ?? [page([])];
  let pageIndex = 0;
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    const r = opts.rpcResult?.(fn, args) ?? {};
    return { data: r.data ?? "applied", error: r.error ?? null };
  });
  const d: ReconcileDeps = {
    getSubscription: vi.fn(async () => opts.sub ?? remoteSub()),
    listPayments: vi.fn(async () => pages[Math.min(pageIndex++, pages.length - 1)]),
    rpc,
  };
  return { d, rpc };
}

describe("reconcileSubscription — webhook perdido", () => {
  it("lê as cobranças na API e as envia ao banco com os valores REMOTOS", async () => {
    const { d, rpc } = deps({ pages: [page([pay("pay_1", "CONFIRMED", { paymentDate: "2026-10-09" }), pay("pay_2", "PENDING")])] });
    const out = await reconcileSubscription(row, d);
    expect(out).toMatchObject({ status: "ok", payments: 2, errors: 0 });
    const calls = rpc.mock.calls.filter(([fn]) => fn === "billing_reconcile_payment");
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toMatchObject({
      p_provider: "asaas",
      p_subscription_ref: "sub_1",
      p_customer_ref: "cus_1",
      p_payment_ref: "pay_1",
      p_remote_status: "CONFIRMED",
      p_remote_deleted: false,
      p_value: 49.9,
      p_due_date: "2026-10-10",
      p_paid_at: "2026-10-09",
    });
  });

  it("o cliente enviado ao banco é o da API (o banco compara com o registrado e acusa divergência)", async () => {
    const { d, rpc } = deps({ sub: remoteSub({ customer: "cus_OUTRO" }), pages: [page([pay("pay_1", "CONFIRMED", { customer: "cus_OUTRO" })])] });
    await reconcileSubscription(row, d);
    for (const [, args] of rpc.mock.calls) expect((args as Record<string, unknown>).p_customer_ref).toBe("cus_OUTRO");
  });

  it("pagina até acabar (hasMore) e respeita o limite de páginas", async () => {
    const { d } = deps({ pages: [page([pay("a", "PENDING")], true), page([pay("b", "PENDING")], true), page([pay("c", "PENDING")], false)] });
    const out = await reconcileSubscription(row, d);
    expect(out.payments).toBe(3);
    expect(d.listPayments).toHaveBeenCalledTimes(3);
    expect((d.listPayments as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1])).toEqual([0, 100, 200]);

    const endless = deps({ pages: [page([pay("x", "PENDING")], true)] });
    const out2 = await reconcileSubscription(row, endless.d);
    expect(endless.d.listPayments).toHaveBeenCalledTimes(5);
    expect(out2.payments).toBe(5);
  });

  it("assinatura INACTIVE ou removida na API é enviada como tal (o banco cancela)", async () => {
    const inactive = deps({ sub: remoteSub({ status: "INACTIVE" }) });
    await reconcileSubscription(row, inactive.d);
    expect(inactive.rpc.mock.calls[0][1]).toMatchObject({ p_remote_status: "INACTIVE", p_remote_deleted: false });

    const removed = deps({ sub: remoteSub({ deleted: true }) });
    await reconcileSubscription(row, removed.d);
    expect(removed.rpc.mock.calls[0][1]).toMatchObject({ p_remote_deleted: true });
  });

  it("404 na assinatura: tratada como removida, sem listar cobranças", async () => {
    const { d, rpc } = deps({ sub: { ok: false, reason: "request_failed", httpStatus: 404 } });
    const out = await reconcileSubscription(row, d);
    expect(out.status).toBe("remote_not_found");
    expect(rpc.mock.calls[0]).toEqual([
      "billing_reconcile_subscription",
      expect.objectContaining({ p_remote_deleted: true, p_customer_ref: "cus_1" }),
    ]);
    expect(d.listPayments).not.toHaveBeenCalled();
  });

  it("API indisponível (rede, 5xx, 401): não altera nada e tenta de novo depois", async () => {
    for (const httpStatus of [undefined, 500, 502, 401]) {
      const { d, rpc } = deps({ sub: { ok: false, reason: "request_failed", httpStatus } });
      const out = await reconcileSubscription(row, d);
      expect(out.status).toBe("unavailable");
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("falha ao listar cobranças: marca indisponível (já aplicado fica aplicado)", async () => {
    const { d } = deps({ pages: [{ ok: false, reason: "request_failed", httpStatus: 500 }] });
    const out = await reconcileSubscription(row, d);
    expect(out.status).toBe("unavailable");
  });

  it("erro de RPC conta como erro e não interrompe as demais cobranças", async () => {
    const { d, rpc } = deps({
      pages: [page([pay("a", "CONFIRMED"), pay("b", "OVERDUE"), pay("c", "PENDING")])],
      rpcResult: (fn, args) => (args.p_payment_ref === "b" ? { error: { message: "falhou" } } : {}),
    });
    const out = await reconcileSubscription(row, d);
    expect(out.errors).toBe(1);
    expect(rpc.mock.calls.filter(([fn]) => fn === "billing_reconcile_payment")).toHaveLength(3);
  });

  it("cobrança mal formada vira erro, sem chamar o banco com lixo", async () => {
    const bad = { id: 7, status: null } as unknown as AsaasPaymentDetail;
    const { d, rpc } = deps({ pages: [page([bad])] });
    const out = await reconcileSubscription(row, d);
    expect(out.errors).toBe(1);
    expect(rpc.mock.calls.filter(([fn]) => fn === "billing_reconcile_payment")).toHaveLength(0);
  });

  it("provedor desconhecido ou referência vazia: inválido, sem rede", async () => {
    const { d } = deps();
    expect((await reconcileSubscription({ ...row, out_provider: "mercadopago" }, d)).status).toBe("invalid");
    expect((await reconcileSubscription({ ...row, out_subscription_ref: "" }, d)).status).toBe("invalid");
    expect(d.getSubscription).not.toHaveBeenCalled();
  });

  it("conta como aplicado apenas applied/cancelled; noop, stale e mismatch não", async () => {
    const results: Record<string, string> = { a: "applied", b: "noop", c: "stale", d: "customer_mismatch", e: "cancelled" };
    const { d } = deps({
      pages: [page(["a", "b", "c", "d", "e"].map((id) => pay(id, "CONFIRMED")))],
      rpcResult: (fn, args) => ({ data: fn === "billing_reconcile_payment" ? results[String(args.p_payment_ref)] : "active_remote" }),
    });
    const out = await reconcileSubscription(row, d);
    expect(out.applied).toBe(2);
  });
});

describe("reconcileBatch", () => {
  it("soma o resultado de todas as assinaturas", async () => {
    const { d } = deps({ pages: [page([pay("a", "CONFIRMED")])] });
    const summary = await reconcileBatch([row, { ...row, out_subscription_ref: "sub_2" }], d);
    expect(summary.checked).toBe(2);
    // por assinatura: 1 conferencia da assinatura + 1 cobranca aplicada
    expect(summary.applied).toBe(4);
  });

  it("para ao estourar o orçamento de tempo", async () => {
    const { d } = deps();
    let t = 0;
    const summary = await reconcileBatch([row, row, row], d, { deadlineMs: 2, now: () => t++ });
    expect(summary.checked).toBe(2);
  });

  it("conta indisponíveis e não encontradas separadamente", async () => {
    const unavailable = deps({ sub: { ok: false, reason: "request_failed", httpStatus: 500 } });
    expect((await reconcileBatch([row], unavailable.d)).unavailable).toBe(1);
    const missing = deps({ sub: { ok: false, reason: "request_failed", httpStatus: 404 } });
    expect((await reconcileBatch([row], missing.d)).notFound).toBe(1);
  });
});
