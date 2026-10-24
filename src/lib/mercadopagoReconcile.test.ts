import { describe, expect, it, vi } from "vitest";
import {
  reconcileMercadoPagoBatch,
  reconcileMercadoPagoSubscription,
  type MercadoPagoReconcileDeps,
} from "./mercadopagoReconcile";
import type { MercadoPagoAuthorizedPayment, MercadoPagoPreapproval, MercadoPagoResult, MercadoPagoSearch } from "./mercadopago";

const REF = "11111111-1111-4111-8111-111111111111";
const PRE = "2c93808472aaaaaa0000000000000001";
const row = { out_provider: "mercadopago", out_subscription_ref: PRE, out_customer_ref: REF };

const pre = (extra: Partial<MercadoPagoPreapproval> = {}): MercadoPagoPreapproval => ({
  id: PRE,
  status: "authorized",
  external_reference: REF,
  ...extra,
});
const inv = (id: number, extra: Partial<MercadoPagoAuthorizedPayment> = {}): MercadoPagoAuthorizedPayment => ({
  id,
  preapproval_id: PRE,
  status: "processed",
  transaction_amount: 49.9,
  debit_date: "2026-10-10T12:00:00.000-03:00",
  payment: { id: id * 10, status: "approved" },
  ...extra,
});
const page = (results: MercadoPagoAuthorizedPayment[], total?: number): MercadoPagoResult<MercadoPagoSearch<MercadoPagoAuthorizedPayment>> => ({
  ok: true,
  data: { results, paging: total === undefined ? undefined : { total } },
});

function makeDeps(opts: {
  preapproval?: MercadoPagoResult<MercadoPagoPreapproval>;
  pages?: MercadoPagoResult<MercadoPagoSearch<MercadoPagoAuthorizedPayment>>[];
  rpc?: (fn: string) => { data: unknown; error: { message: string } | null };
} = {}) {
  const pages = opts.pages ?? [page([])];
  let call = 0;
  const getPreapproval = vi.fn(async () => opts.preapproval ?? ({ ok: true, data: pre() } as MercadoPagoResult<MercadoPagoPreapproval>));
  const listAuthorizedPayments = vi.fn<MercadoPagoReconcileDeps["listAuthorizedPayments"]>(async () => pages[Math.min(call++, pages.length - 1)]);
  const rpc = vi.fn<MercadoPagoReconcileDeps["rpc"]>(async (fn) => opts.rpc?.(fn) ?? { data: "applied", error: null });
  const deps: MercadoPagoReconcileDeps = { getPreapproval, listAuthorizedPayments, rpc };
  return { deps, getPreapproval, listAuthorizedPayments, rpc };
}

describe("reconcileMercadoPagoSubscription", () => {
  it("outro provedor ou sem referência: inválido, sem chamar nada", async () => {
    const t = makeDeps();
    for (const bad of [{ ...row, out_provider: "asaas" }, { ...row, out_subscription_ref: "" }]) {
      expect((await reconcileMercadoPagoSubscription(bad, t.deps)).status).toBe("invalid");
    }
    expect(t.getPreapproval).not.toHaveBeenCalled();
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("lê assinatura e faturas na API e envia ao banco o status combinado, valor e vencimento (Brasília)", async () => {
    const t = makeDeps({ pages: [page([inv(1), inv(2, { status: "scheduled", payment: null })], 2)] });
    const out = await reconcileMercadoPagoSubscription(row, t.deps);
    expect(out).toMatchObject({ status: "ok", payments: 2, errors: 0 });
    expect(t.rpc).toHaveBeenCalledWith("billing_reconcile_subscription", {
      p_provider: "mercadopago",
      p_subscription_ref: PRE,
      p_customer_ref: REF,
      p_remote_status: "authorized",
      p_remote_deleted: false,
    });
    expect(t.rpc).toHaveBeenCalledWith("billing_reconcile_payment", {
      p_provider: "mercadopago",
      p_subscription_ref: PRE,
      p_customer_ref: REF,
      p_payment_ref: "1",
      p_remote_status: "processed/approved",
      p_remote_deleted: false,
      p_value: 49.9,
      p_due_date: "2026-10-10",
      p_paid_at: null,
    });
    expect(t.rpc).toHaveBeenCalledWith("billing_reconcile_payment", expect.objectContaining({ p_payment_ref: "2", p_remote_status: "scheduled/" }));
  });

  it("o cliente enviado ao banco é a referência lida na API (o banco compara com a registrada)", async () => {
    const t = makeDeps({ preapproval: { ok: true, data: pre({ external_reference: "de-outra-assinatura" }) } });
    await reconcileMercadoPagoSubscription(row, t.deps);
    expect(t.rpc.mock.calls[0][1]).toMatchObject({ p_customer_ref: "de-outra-assinatura" });
    const none = makeDeps({ preapproval: { ok: true, data: pre({ external_reference: null }) } });
    await reconcileMercadoPagoSubscription(row, none.deps);
    expect(none.rpc.mock.calls[0][1]).toMatchObject({ p_customer_ref: "" });
  });

  it("assinatura cancelada na API: o banco recebe o status cancelled", async () => {
    const t = makeDeps({ preapproval: { ok: true, data: pre({ status: "cancelled" }) }, rpc: (fn) => ({ data: fn === "billing_reconcile_subscription" ? "cancelled" : "noop", error: null }) });
    const out = await reconcileMercadoPagoSubscription(row, t.deps);
    expect(out.subscriptionResult).toBe("cancelled");
    expect(out.applied).toBe(1);
    expect(t.rpc.mock.calls[0][1]).toMatchObject({ p_remote_status: "cancelled", p_remote_deleted: false });
  });

  it("404 na assinatura: tratada como removida (cancelamento) e não lista faturas", async () => {
    const t = makeDeps({ preapproval: { ok: false, reason: "request_failed", httpStatus: 404 } });
    const out = await reconcileMercadoPagoSubscription(row, t.deps);
    expect(out.status).toBe("remote_not_found");
    expect(t.rpc).toHaveBeenCalledTimes(1);
    expect(t.rpc.mock.calls[0][1]).toMatchObject({ p_remote_deleted: true, p_customer_ref: REF });
    expect(t.listAuthorizedPayments).not.toHaveBeenCalled();
  });

  it("API indisponível (5xx, 429, rede): nada é alterado", async () => {
    for (const httpStatus of [500, 429, undefined]) {
      const t = makeDeps({ preapproval: { ok: false, reason: "request_failed", httpStatus } });
      const out = await reconcileMercadoPagoSubscription(row, t.deps);
      expect(out.status).toBe("unavailable");
      expect(t.rpc).not.toHaveBeenCalled();
    }
  });

  it("falha ao listar as faturas: indisponível (a assinatura já foi reconciliada)", async () => {
    const t = makeDeps({ pages: [{ ok: false, reason: "request_failed", httpStatus: 502 }] });
    const out = await reconcileMercadoPagoSubscription(row, t.deps);
    expect(out.status).toBe("unavailable");
    expect(t.rpc.mock.calls.map(([fn]) => fn)).toEqual(["billing_reconcile_subscription"]);
  });

  it("pagina até o total informado e para sem resultados", async () => {
    const make = (from: number, n: number) => Array.from({ length: n }, (_, i) => inv(from + i));
    const t = makeDeps({ pages: [page(make(1, 50), 120), page(make(51, 50), 120), page(make(101, 20), 120)] });
    const out = await reconcileMercadoPagoSubscription(row, t.deps);
    expect(out.payments).toBe(120);
    expect(t.listAuthorizedPayments).toHaveBeenCalledTimes(3);
    expect(t.listAuthorizedPayments.mock.calls.map((c) => c[1])).toEqual([0, 50, 100]);
    const empty = makeDeps({ pages: [page([], 999)] });
    await reconcileMercadoPagoSubscription(row, empty.deps);
    expect(empty.listAuthorizedPayments).toHaveBeenCalledTimes(1);
  });

  it("respeita o limite de páginas por assinatura", async () => {
    const full = page(Array.from({ length: 50 }, (_, i) => inv(i + 1)), 100000);
    const t = makeDeps({ pages: [full] });
    await reconcileMercadoPagoSubscription(row, t.deps);
    expect(t.listAuthorizedPayments).toHaveBeenCalledTimes(5);
  });

  it("fatura malformada conta como erro e é pulada; erro do banco conta como erro", async () => {
    const bad = { id: undefined, preapproval_id: PRE, status: "processed" } as unknown as MercadoPagoAuthorizedPayment;
    const t = makeDeps({
      pages: [page([bad, inv(7)], 2)],
      rpc: (fn) => (fn === "billing_reconcile_payment" ? { data: null, error: { message: "boom" } } : { data: "active_remote", error: null }),
    });
    const out = await reconcileMercadoPagoSubscription(row, t.deps);
    expect(out.payments).toBe(2);
    expect(out.errors).toBe(2);
    expect(t.rpc.mock.calls.filter(([fn]) => fn === "billing_reconcile_payment")).toHaveLength(1);
  });

  it("valor inexistente ou inválido vai ao banco como null (o banco recusa confirmar sem valor)", async () => {
    const t = makeDeps({ pages: [page([inv(1, { transaction_amount: "abc" }), inv(2, { transaction_amount: undefined })], 2)] });
    await reconcileMercadoPagoSubscription(row, t.deps);
    const calls = t.rpc.mock.calls.filter(([fn]) => fn === "billing_reconcile_payment");
    expect(calls.map((c) => c[1].p_value)).toEqual([null, null]);
  });
});

describe("reconcileMercadoPagoBatch", () => {
  it("soma o resumo de todas as assinaturas", async () => {
    const t = makeDeps({ pages: [page([inv(1)], 1)] });
    const rows = [row, { ...row, out_subscription_ref: "2c93808472aaaaaa0000000000000002" }];
    const summary = await reconcileMercadoPagoBatch(rows, t.deps);
    expect(summary).toEqual({ checked: 2, applied: 4, unavailable: 0, notFound: 0, errors: 0 });
  });

  it("para quando o orçamento de tempo acaba", async () => {
    const t = makeDeps();
    let clock = 0;
    const summary = await reconcileMercadoPagoBatch([row, row, row], t.deps, { deadlineMs: 2, now: () => clock++ });
    expect(summary.checked).toBe(2);
  });
});
