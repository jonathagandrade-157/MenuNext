import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { openSecret, parseEncryptionKey, sealSecret } from "./secretBox";
import {
  createMercadoPagoPixPayment,
  extractWebhookPaymentId,
  getMercadoPagoAccountId,
  isDefinitiveFailure,
  isPlausibleWebhookSecret,
  getPixAutoConfig,
  isPlausibleMercadoPagoToken,
  mapMercadoPagoStatus,
  parseMercadoPagoPayment,
  parseWebhookUrl,
  tokenHint,
} from "./pixAuto";
import { ensurePixCharge, syncPixCharge } from "./pixAutoService";
import { handlePixWebhook } from "./pixWebhookHandler";
import { describePanelPixStatus } from "./pixCharge";

const KEY_B64 = Buffer.alloc(32, 7).toString("base64");
const KEY = parseEncryptionKey(KEY_B64)!;
const TOKEN = "APP_USR-1234567890abcdefghij-XYZ9";
const PUB = "11111111-2222-4333-8444-555555555555";
const QR = "00020126580014br.gov.bcb.pix0136abc520400005303986540580.005802BR6304ABCD";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("secretBox", () => {
  it("cifra e decifra; texto cifrado não contém o token e muda a cada vez", () => {
    const a = sealSecret(TOKEN, "loja-1", KEY);
    const b = sealSecret(TOKEN, "loja-1", KEY);
    expect(a).not.toBe(b);
    expect(a).not.toContain("APP_USR");
    expect(a).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(openSecret(a, "loja-1", KEY)).toBe(TOKEN);
  });
  it("recusa chave errada, contexto (loja) errado e texto adulterado", () => {
    const sealed = sealSecret(TOKEN, "loja-1", KEY);
    expect(openSecret(sealed, "loja-2", KEY)).toBeNull();
    expect(openSecret(sealed, "loja-1", Buffer.alloc(32, 9))).toBeNull();
    const parts = sealed.split(":");
    const flipped = parts[3][0] === "A" ? "B" + parts[3].slice(1) : "A" + parts[3].slice(1);
    expect(openSecret([parts[0], parts[1], parts[2], flipped].join(":"), "loja-1", KEY)).toBeNull();
    expect(openSecret("lixo", "loja-1", KEY)).toBeNull();
    expect(openSecret(null, "loja-1", KEY)).toBeNull();
  });
  it("chave precisa ter exatamente 32 bytes", () => {
    expect(parseEncryptionKey(Buffer.alloc(16).toString("base64"))).toBeNull();
    expect(parseEncryptionKey("não é base64!")).toBeNull();
    expect(parseEncryptionKey(undefined)).toBeNull();
    expect(parseEncryptionKey(KEY_B64)?.length).toBe(32);
  });
});

describe("configuração (desligado por padrão)", () => {
  const full = { PIX_AUTO_ENABLED: "true", PIX_PAYER_EMAIL: "pagamentos@menunext.test" };
  it("liga só com TODAS as condições (variáveis, chave de cifra e service_role)", () => {
    expect(getPixAutoConfig(full, KEY, true)).not.toBeNull();
    expect(getPixAutoConfig({}, KEY, true)).toBeNull();
    expect(getPixAutoConfig(full, null, true)).toBeNull();
    expect(getPixAutoConfig(full, KEY, false)).toBeNull();
    for (const key of Object.keys(full)) {
      expect(getPixAutoConfig({ ...full, [key]: undefined }, KEY, true), key).toBeNull();
    }
    expect(getPixAutoConfig({ ...full, PIX_AUTO_ENABLED: "1" }, KEY, true)).toBeNull();
    expect(getPixAutoConfig({ ...full, PIX_PAYER_EMAIL: "sem-arroba" }, KEY, true)).toBeNull();
    // o ambiente de teste não tem nada configurado: desligado
    expect(getPixAutoConfig()).toBeNull();
  });
  it("webhook opcional e só https", () => {
    expect(getPixAutoConfig(full, KEY, true)?.webhookUrl).toBeNull();
    expect(parseWebhookUrl("https://app.test/api/webhooks/pix-mercadopago")).toBe("https://app.test/api/webhooks/pix-mercadopago");
    expect(parseWebhookUrl("http://app.test/x")).toBeNull();
    expect(parseWebhookUrl("https://u:p@app.test/x")).toBeNull();
    expect(parseWebhookUrl("lixo")).toBeNull();
  });
  it("token: formato e dica sem revelar", () => {
    expect(isPlausibleMercadoPagoToken(TOKEN)).toBe(true);
    expect(isPlausibleMercadoPagoToken("TEST-abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(isPlausibleMercadoPagoToken("senha123")).toBe(false);
    expect(isPlausibleMercadoPagoToken("APP_USR-curto")).toBe(false);
    expect(tokenHint(TOKEN)).toBe("XYZ9");
  });
});

describe("leitura da resposta do Mercado Pago", () => {
  it("status: só approved aprova; expirado e recusados não", () => {
    expect(mapMercadoPagoStatus("approved")).toBe("approved");
    expect(mapMercadoPagoStatus("pending")).toBe("pending");
    expect(mapMercadoPagoStatus("in_process")).toBe("pending");
    expect(mapMercadoPagoStatus("authorized")).toBe("pending");
    expect(mapMercadoPagoStatus("cancelled", "expired")).toBe("expired");
    expect(mapMercadoPagoStatus("cancelled")).toBe("cancelled");
    expect(mapMercadoPagoStatus("rejected")).toBe("cancelled");
    expect(mapMercadoPagoStatus("refunded")).toBe("cancelled");
    expect(mapMercadoPagoStatus(undefined)).toBe("pending");
  });
  it("extrai id, valor, referência e copia e cola; recusa formato estranho", () => {
    const p = parseMercadoPagoPayment({
      id: 5466310457, status: "pending", transaction_amount: 80, external_reference: PUB, payment_method_id: "pix",
      date_of_expiration: "2026-11-07T20:00:00.000-03:00", point_of_interaction: { transaction_data: { qr_code: QR } },
    });
    expect(p).toEqual({ id: "5466310457", status: "pending", amount: 80, externalReference: PUB, qrCode: QR, expiresAt: "2026-11-07T20:00:00.000-03:00", currency: null, collectorId: null });
    expect(parseMercadoPagoPayment({ id: 1, currency_id: "BRL", collector_id: 777 })).toMatchObject({ currency: "BRL", collectorId: "777" });
    expect(parseMercadoPagoPayment({ id: 1, collector: { id: "888" } })).toMatchObject({ collectorId: "888" });
    expect(parseMercadoPagoPayment({ id: "abc" })).toBeNull();
    expect(parseMercadoPagoPayment({ id: 1, payment_method_id: "visa" })).toBeNull();
    expect(parseMercadoPagoPayment(null)).toBeNull();
  });
  it("id do aviso (webhook): corpo ou query; outros tipos ignorados", () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(extractWebhookPaymentId({ type: "payment", data: { id: "123" } }, q(""))).toBe("123");
    expect(extractWebhookPaymentId({ type: "payment", data: { id: 123 } }, q(""))).toBe("123");
    expect(extractWebhookPaymentId(null, q("data.id=456&type=payment"))).toBe("456");
    expect(extractWebhookPaymentId({ type: "subscription_preapproval", data: { id: "1" } }, q(""))).toBeNull();
    expect(extractWebhookPaymentId({ type: "payment", data: { id: "1; drop" } }, q(""))).toBeNull();
  });
});

describe("chamada ao Mercado Pago", () => {
  it("POST /v1/payments com pix, valor, referência, expiração e idempotência pelo pedido", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 9, status: "pending", transaction_amount: 80, external_reference: PUB, point_of_interaction: { transaction_data: { qr_code: QR } } }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await createMercadoPagoPixPayment(TOKEN, { amount: 80, description: "Pedido #1 - Loja", orderPublicId: PUB, payerEmail: "p@x.test", expiresAt: "2026-11-07T23:00:00.000Z", notificationUrl: null });
    expect(r.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.mercadopago.com/v1/payments");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers["X-Idempotency-Key"]).toBe(`menunext-pix-${PUB}`);
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ transaction_amount: 80, description: "Pedido #1 - Loja", payment_method_id: "pix", payer: { email: "p@x.test" }, external_reference: PUB, date_of_expiration: "2026-11-07T23:00:00.000Z" });
  });
  it("erro HTTP e rede viram resultado (nunca exceção)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "unauthorized" }), { status: 401 })));
    expect(await createMercadoPagoPixPayment(TOKEN, { amount: 1, description: "x", orderPublicId: PUB, payerEmail: "p@x.test", expiresAt: "x", notificationUrl: null })).toEqual({ ok: false, reason: "request_failed", httpStatus: 401 });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await createMercadoPagoPixPayment(TOKEN, { amount: 1, description: "x", orderPublicId: PUB, payerEmail: "p@x.test", expiresAt: "x", notificationUrl: null })).toEqual({ ok: false, reason: "request_failed" });
  });
});

// ---------------------------------------------------------------------------
// Serviço: banco e Mercado Pago falsos
// ---------------------------------------------------------------------------
type Handler = (args: Record<string, unknown>) => { data?: unknown; error?: { message: string } | null };
function fakeAdmin(handlers: Record<string, Handler>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const admin = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const h = handlers[fn];
      if (!h) return { data: null, error: { message: `unexpected ${fn}` } };
      const r = h(args);
      return { data: r.data ?? null, error: r.error ?? null };
    },
  } as unknown as SupabaseClient;
  return { admin, calls };
}
const config = { encryptionKey: KEY, payerEmail: "pagamentos@menunext.test", webhookUrl: null };
const RID = "rest-1";
const COLLECTOR = "777";
const sealed = sealSecret(TOKEN, RID, KEY);
const WH_SECRET = "segredo-do-webhook-da-loja-0123456789";
const sealedWh = sealSecret(WH_SECRET, `${RID}:webhook`, KEY);
const begin = (over: Record<string, unknown> = {}) => ({
  charge_id: "c1", restaurant_id: RID, order_number: 7, amount: "80.00", restaurant_name: "Loja",
  token_ciphertext: sealed, collector_id: COLLECTOR, attempts: 1, ...over,
});
const mpPayment = (over: Record<string, unknown> = {}, status = 200) =>
  new Response(JSON.stringify({
    id: 555, status: "pending", transaction_amount: 80, external_reference: PUB, payment_method_id: "pix", currency_id: "BRL",
    collector_id: 777, date_of_expiration: "2026-11-07T23:00:00.000Z", point_of_interaction: { transaction_data: { qr_code: QR } }, ...over,
  }), { status });

describe("ensurePixCharge (reserva -> Mercado Pago -> registro)", () => {
  it("sem configuração no servidor: não chama banco nem Mercado Pago", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await ensurePixCharge("loja", PUB)).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sem reserva (loja desligada, já criada ou tentativa em andamento): não chama o Mercado Pago", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { admin } = fakeAdmin({ pix_charge_begin_backend: () => ({ data: [] }) });
    expect(await ensurePixCharge("loja", PUB, { admin, config })).toBe("busy");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("cria com o valor RESERVADO pelo banco e registra o copia e cola", async () => {
    const fetchMock = vi.fn(async () => mpPayment());
    vi.stubGlobal("fetch", fetchMock);
    const { admin, calls } = fakeAdmin({ pix_charge_begin_backend: () => ({ data: [begin()] }), pix_charge_register_backend: () => ({ data: "pending" }) });
    expect(await ensurePixCharge("loja", PUB, { admin, config, now: () => new Date("2026-11-07T22:30:00.000Z") })).toBe("created");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).transaction_amount).toBe(80);
    expect((init.headers as Record<string, string>)["X-Idempotency-Key"]).toBe(`menunext-pix-${PUB}`);
    expect(calls.find((c) => c.fn === "pix_charge_register_backend")?.args).toEqual({ p_charge: "c1", p_provider_payment_id: "555", p_amount: 80, p_qr_code: QR, p_expires_at: "2026-11-07T23:00:00.000Z" });
  });
  it("resposta INDEFINIDA (rede, 5xx, 429, corpo ilegível): fica 'creating', nunca falha nem libera a chave comum", async () => {
    const cases: (() => Promise<Response>)[] = [
      async () => { throw new Error("timeout"); },
      async () => new Response(JSON.stringify({ message: "boom" }), { status: 502 }),
      async () => new Response(JSON.stringify({ message: "slow down" }), { status: 429 }),
      async () => new Response("<html>", { status: 200 }),
    ];
    for (const impl of cases) {
      vi.stubGlobal("fetch", vi.fn(impl));
      const { admin, calls } = fakeAdmin({ pix_charge_begin_backend: () => ({ data: [begin()] }) });
      expect(await ensurePixCharge("loja", PUB, { admin, config })).toBe("creating");
      expect(calls.some((c) => c.fn === "pix_charge_fail_backend" || c.fn === "pix_charge_register_backend")).toBe(false);
    }
  });
  it("retomada usa a MESMA chave de idempotência (o Mercado Pago devolve o mesmo pagamento)", async () => {
    const fetchMock = vi.fn(async () => mpPayment());
    vi.stubGlobal("fetch", fetchMock);
    const { admin } = fakeAdmin({ pix_charge_begin_backend: () => ({ data: [begin({ attempts: 3 })] }), pix_charge_register_backend: () => ({ data: "pending" }) });
    expect(await ensurePixCharge("loja", PUB, { admin, config })).toBe("created");
    expect(((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>)["X-Idempotency-Key"]).toBe(`menunext-pix-${PUB}`);
  });
  it("muitas tentativas indefinidas: desiste ('failed'); nenhum QR foi mostrado ao cliente", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const { admin, calls } = fakeAdmin({ pix_charge_begin_backend: () => ({ data: [begin({ attempts: 6 })] }), pix_charge_fail_backend: () => ({}) });
    expect(await ensurePixCharge("loja", PUB, { admin, config })).toBe("failed");
    expect(calls.find((c) => c.fn === "pix_charge_fail_backend")?.args).toEqual({ p_charge: "c1", p_reason: "provider_unavailable" });
  });
  it("recusa DEFINITIVA (401/400): 'failed' na hora", async () => {
    for (const status of [400, 401, 403]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "no" }), { status })));
      const { admin, calls } = fakeAdmin({ pix_charge_begin_backend: () => ({ data: [begin()] }), pix_charge_fail_backend: () => ({}) });
      expect(await ensurePixCharge("loja", PUB, { admin, config })).toBe("failed");
      expect(calls.find((c) => c.fn === "pix_charge_fail_backend")?.args.p_reason).toBe("provider_rejected");
    }
  });
  it("resposta com valor, referência, moeda ou conta recebedora diferente nunca vira QR", async () => {
    for (const over of [{ transaction_amount: 79.99 }, { external_reference: "outro" }, { point_of_interaction: {} }, { currency_id: "USD" }, { collector_id: 999 }]) {
      vi.stubGlobal("fetch", vi.fn(async () => mpPayment(over)));
      const { admin, calls } = fakeAdmin({ pix_charge_begin_backend: () => ({ data: [begin()] }), pix_charge_fail_backend: () => ({}), pix_charge_register_backend: () => ({ data: "pending" }) });
      expect(await ensurePixCharge("loja", PUB, { admin, config })).toBe("failed");
      expect(calls.some((c) => c.fn === "pix_charge_register_backend")).toBe(false);
    }
  });
  it("token cifrado de outra loja (ou chave trocada) não é usado", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { admin } = fakeAdmin({ pix_charge_begin_backend: () => ({ data: [begin({ restaurant_id: "rest-2" })] }), pix_charge_fail_backend: () => ({}) });
    expect(await ensurePixCharge("loja", PUB, { admin, config })).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("syncPixCharge", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    charge_id: "c1", restaurant_id: RID, provider_payment_id: "555", status: "pending", amount: "80.00", collector_id: COLLECTOR,
    order_public_id: PUB, token_ciphertext: sealed, webhook_secret_ciphertext: null, ...over,
  });
  it("consulta o Mercado Pago e aplica o que ELE disse (valor, moeda, conta, referência de lá)", async () => {
    const fetchMock = vi.fn(async () => mpPayment({ status: "approved" }));
    vi.stubGlobal("fetch", fetchMock);
    const { admin, calls } = fakeAdmin({ pix_charge_for_sync_backend: () => ({ data: [row()] }), pix_charge_apply_backend: () => ({ data: "approved" }) });
    expect(await syncPixCharge({ providerPaymentId: "555" }, 2, { admin, config })).toEqual({ status: "approved" });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://api.mercadopago.com/v1/payments/555");
    expect(calls.find((c) => c.fn === "pix_charge_apply_backend")?.args).toEqual({
      p_provider_payment_id: "555", p_status: "approved", p_amount: 80, p_external_reference: PUB, p_currency: "BRL", p_collector_id: "777",
    });
  });
  it("consulta recente (throttle) ou cobrança desconhecida: não chama o Mercado Pago", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { admin } = fakeAdmin({ pix_charge_for_sync_backend: () => ({ data: [] }) });
    expect(await syncPixCharge({ slug: "loja", publicId: PUB }, 10, { admin, config })).toEqual({ status: "skipped" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("resposta de OUTRO pagamento não é aplicada", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mpPayment({ id: 999, status: "approved" })));
    const { admin, calls } = fakeAdmin({ pix_charge_for_sync_backend: () => ({ data: [row()] }), pix_charge_apply_backend: () => ({ data: "approved" }) });
    expect(await syncPixCharge({ providerPaymentId: "555" }, 0, { admin, config })).toEqual({ status: "failed" });
    expect(calls.some((c) => c.fn === "pix_charge_apply_backend")).toBe(false);
  });
  it("banco recusa (payment_mismatch): falha sem lançar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mpPayment({ status: "approved", collector_id: 1 })));
    const { admin } = fakeAdmin({ pix_charge_for_sync_backend: () => ({ data: [row()] }), pix_charge_apply_backend: () => ({ error: { message: "payment_mismatch" } }) });
    expect(await syncPixCharge({ providerPaymentId: "555" }, 0, { admin, config })).toEqual({ status: "failed" });
  });

  // assinatura conforme a documentação do Mercado Pago: HMAC-SHA256(segredo, "id:<data.id>;request-id:<x-request-id>;ts:<ts>;")
  const sign = (secret: string, dataId: string, requestId: string, ts: string) =>
    `ts=${ts},v1=${createHmac("sha256", secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest("hex")}`;
  it("loja com assinatura secreta: aviso com x-signature válido é processado", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mpPayment({ status: "approved" })));
    const { admin } = fakeAdmin({ pix_charge_for_sync_backend: () => ({ data: [row({ webhook_secret_ciphertext: sealedWh })] }), pix_charge_apply_backend: () => ({ data: "approved" }) });
    const signature = { xSignature: sign(WH_SECRET, "555", "req-1", "1762550000"), xRequestId: "req-1", dataId: "555" };
    expect(await syncPixCharge({ providerPaymentId: "555", signature }, 0, { admin, config })).toEqual({ status: "approved" });
  });
  it("loja com assinatura secreta: aviso sem assinatura, com assinatura errada ou de outra notificação é recusado SEM consultar", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const bad = [
      undefined,
      { xSignature: null, xRequestId: "req-1", dataId: "555" },
      { xSignature: sign("outro-segredo-qualquer-0123456789", "555", "req-1", "1"), xRequestId: "req-1", dataId: "555" },
      { xSignature: sign(WH_SECRET, "555", "req-1", "1"), xRequestId: "req-2", dataId: "555" },
      { xSignature: sign(WH_SECRET, "556", "req-1", "1"), xRequestId: "req-1", dataId: "555" },
    ];
    for (const signature of bad) {
      const { admin, calls } = fakeAdmin({ pix_charge_for_sync_backend: () => ({ data: [row({ webhook_secret_ciphertext: sealedWh })] }) });
      expect(await syncPixCharge({ providerPaymentId: "555", signature }, 0, { admin, config })).toEqual({ status: "unauthorized" });
      expect(calls.some((c) => c.fn === "pix_charge_apply_backend")).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("segredo cifrado de outra loja não valida a assinatura", async () => {
    const { admin } = fakeAdmin({ pix_charge_for_sync_backend: () => ({ data: [row({ webhook_secret_ciphertext: sealSecret(WH_SECRET, "rest-2:webhook", KEY) })] }) });
    const signature = { xSignature: sign(WH_SECRET, "555", "req-1", "1"), xRequestId: "req-1", dataId: "555" };
    expect(await syncPixCharge({ providerPaymentId: "555", signature }, 0, { admin, config })).toEqual({ status: "unauthorized" });
  });
});

describe("webhook do Pix automático", () => {
  const deps = (over: Partial<Parameters<typeof handlePixWebhook>[1]> = {}) => ({
    enabled: true, rateLimited: async () => false, sync: vi.fn(async () => ({ status: "approved" })), ...over,
  });
  const input = (rawBody: string, query = "") => ({ rawBody, searchParams: new URLSearchParams(query), xSignature: "ts=1,v1=ab", xRequestId: "req-9" });
  it("desligado: 404 sem consultar nada", async () => {
    const d = deps({ enabled: false });
    expect((await handlePixWebhook(input("{}"), d)).status).toBe(404);
    expect(d.sync).not.toHaveBeenCalled();
  });
  it("aviso válido só dispara a consulta (o corpo não aprova nada) e repassa a assinatura", async () => {
    const d = deps();
    const r = await handlePixWebhook(input(JSON.stringify({ type: "payment", data: { id: "555" }, status: "approved" }), "data.id=555&type=payment"), d);
    expect(r).toEqual({ status: 200, body: { result: "ok" } });
    expect(d.sync).toHaveBeenCalledWith("555", { xSignature: "ts=1,v1=ab", xRequestId: "req-9", dataId: "555" });
  });
  it("assinatura inválida = 401; falha transitória = 500 (o Mercado Pago reenvia)", async () => {
    expect((await handlePixWebhook(input("", "data.id=555&type=payment"), deps({ sync: vi.fn(async () => ({ status: "unauthorized" })) }))).status).toBe(401);
    expect((await handlePixWebhook(input("", "data.id=555&type=payment"), deps({ sync: vi.fn(async () => ({ status: "failed" })) }))).status).toBe(500);
  });
  it("corpo inválido, grande demais, sem id ou limitado por IP", async () => {
    expect((await handlePixWebhook(input("{"), deps())).status).toBe(400);
    expect((await handlePixWebhook(input("x".repeat(9000)), deps())).status).toBe(413);
    const d = deps();
    expect(await handlePixWebhook(input(JSON.stringify({ type: "payment", data: {} })), d)).toEqual({ status: 200, body: { result: "ignored" } });
    expect(d.sync).not.toHaveBeenCalled();
    expect((await handlePixWebhook(input("{}"), deps({ rateLimited: async () => true }))).status).toBe(429);
  });
});

describe("conta do token e falhas definitivas", () => {
  it("GET /users/me devolve a conta recebedora", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: 777, nickname: "LOJA" }), { status: 200 })));
    expect(await getMercadoPagoAccountId(TOKEN)).toEqual({ ok: true, collectorId: "777" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "invalid token" }), { status: 401 })));
    expect(await getMercadoPagoAccountId(TOKEN)).toMatchObject({ ok: false, httpStatus: 401 });
  });
  it("classifica definitiva x indefinida", () => {
    expect(isDefinitiveFailure({ ok: false, reason: "request_failed", httpStatus: 400 })).toBe(true);
    expect(isDefinitiveFailure({ ok: false, reason: "request_failed", httpStatus: 401 })).toBe(true);
    for (const f of [{ httpStatus: 500 }, { httpStatus: 429 }, { httpStatus: 408 }, { httpStatus: 409 }, {}]) {
      expect(isDefinitiveFailure({ ok: false, reason: "request_failed", ...f })).toBe(false);
    }
    expect(isDefinitiveFailure({ ok: false, reason: "invalid_response", httpStatus: 400 })).toBe(false);
  });
  it("assinatura secreta: formato plausível", () => {
    expect(isPlausibleWebhookSecret(WH_SECRET)).toBe(true);
    expect(isPlausibleWebhookSecret("curto")).toBe(false);
    expect(isPlausibleWebhookSecret("com espaço no meio 0123456789")).toBe(false);
  });
});

describe("linha do painel", () => {
  it("só 'approved' dispensa conferência; o resto pede extrato quando o cliente pode ter pago pela chave", () => {
    expect(describePanelPixStatus("approved").tone).toBe("success");
    expect(describePanelPixStatus("pending").tone).toBe("info");
    expect(describePanelPixStatus("creating").tone).toBe("info");
    for (const s of ["failed", "cancelled", "expired", null]) expect(describePanelPixStatus(s).text).toMatch(/confir[ae].*extrato/);
  });
});
