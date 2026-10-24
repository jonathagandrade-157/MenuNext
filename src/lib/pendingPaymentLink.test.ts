import { describe, expect, it, vi } from "vitest";
import { resolvePendingPaymentLink, type PendingSubscriptionRow } from "./pendingPaymentLink";
import type { MercadoPagoPreapproval, MercadoPagoResult } from "./mercadopago";

const INTERNAL = "11111111-1111-4111-8111-111111111111";
const PRE = "2c93808472aaaaaa0000000000000001";
const CHECKOUT = "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=2c93808472aaaaaa0000000000000001";

const row = (extra: Partial<PendingSubscriptionRow> = {}): PendingSubscriptionRow => ({
  out_subscription_id: INTERNAL,
  out_provider: "mercadopago",
  out_subscription_ref: PRE,
  out_amount: "49.90",
  ...extra,
});

const pre = (extra: Partial<MercadoPagoPreapproval> = {}): MercadoPagoPreapproval => ({
  id: PRE,
  status: "pending",
  external_reference: INTERNAL,
  init_point: CHECKOUT,
  auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 49.9, currency_id: "BRL" },
  ...extra,
});

const deps = (result: MercadoPagoResult<MercadoPagoPreapproval>) => ({ getPreapproval: vi.fn(async () => result) });

describe("resolvePendingPaymentLink", () => {
  it("assinatura pendente conferida: devolve o link lido na API", async () => {
    const d = deps({ ok: true, data: pre() });
    expect(await resolvePendingPaymentLink(row(), d)).toEqual({ status: "link", url: CHECKOUT });
    expect(d.getPreapproval).toHaveBeenCalledWith(PRE);
  });

  it("sem assinatura pendente: erro claro e nenhuma chamada à API", async () => {
    const d = deps({ ok: true, data: pre() });
    for (const none of [null, undefined]) {
      expect((await resolvePendingPaymentLink(none, d)).status).toBe("error");
    }
    expect(d.getPreapproval).not.toHaveBeenCalled();
  });

  it("assinatura de outro provedor (Asaas): só informa, sem consultar o Mercado Pago", async () => {
    const d = deps({ ok: true, data: pre() });
    const res = await resolvePendingPaymentLink(row({ out_provider: "asaas", out_subscription_ref: "sub_000000000A01" }), d);
    expect(res.status).toBe("info");
    expect(d.getPreapproval).not.toHaveBeenCalled();
  });

  it("já autorizada no Mercado Pago: informa que falta só a confirmação da cobrança (sem link)", async () => {
    const res = await resolvePendingPaymentLink(row(), deps({ ok: true, data: pre({ status: "authorized" }) }));
    expect(res.status).toBe("info");
    expect((res as { url?: string }).url).toBeUndefined();
  });

  it("não devolve link se a leitura não confere (referência, valor, id, status cancelado)", async () => {
    const bad: Partial<MercadoPagoPreapproval>[] = [
      { external_reference: "outra" },
      { id: "2c93808472aaaaaa0000000000000999" },
      { status: "cancelled" },
      { auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 1, currency_id: "BRL" } },
    ];
    for (const extra of bad) {
      const res = await resolvePendingPaymentLink(row(), deps({ ok: true, data: pre(extra) }));
      expect(res.status).toBe("error");
    }
  });

  it("link ausente ou de outro domínio: erro, nunca redireciona", async () => {
    for (const init_point of [undefined, null, "", "http://www.mercadopago.com.br/x", "https://mercadopago.com.evil.example/x"]) {
      const res = await resolvePendingPaymentLink(row(), deps({ ok: true, data: pre({ init_point: init_point as string | null | undefined }) }));
      expect(res.status).toBe("error");
    }
  });

  it("API indisponível: erro", async () => {
    expect((await resolvePendingPaymentLink(row(), deps({ ok: false, reason: "request_failed", httpStatus: 503 }))).status).toBe("error");
  });
});
