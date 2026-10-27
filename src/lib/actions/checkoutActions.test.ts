import { beforeEach, describe, expect, it, vi } from "vitest";

// Verificação de FIAÇÃO com dependências simuladas (não é validação de produção): as ações do checkout público usam
// o caminho do servidor (callPublicRpc) depois dos limites, e a venda de balcão usa a sessão do membro.
const h = vi.hoisted(() => ({
  publicRpc: vi.fn(),
  sessionRpc: vi.fn(),
  ipLimit: vi.fn(),
  storeLimit: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/publicRpc", () => ({ callPublicRpc: h.publicRpc }));
vi.mock("@/lib/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rateLimit")>()),
  checkIpRateLimit: h.ipLimit,
  getClientIp: async () => "203.0.113.7",
  checkRateLimit: h.storeLimit,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    rpc: h.sessionRpc,
  }),
}));
vi.mock("@/lib/tenant", () => ({ getMyRestaurant: async () => ({ id: "r1", slug: "loja-a" }) }));
vi.mock("@/lib/cash", () => ({ getCurrentCashSession: async () => ({ id: "c1" }) }));
vi.mock("@/lib/actions/delivery-quote", () => ({ resolveDeliveryDistanceForOrder: async () => ({ ok: true, distanceKm: null }) }));
vi.mock("@/lib/store", () => ({ getPublicProductDetail: async () => null }));
vi.mock("@/lib/storage/assets", () => ({ getPublicAssetUrl: () => "" }));

import { submitOrderAction, type SubmitOrderInput } from "./orders";
import { validateCouponAction } from "./couponValidate";
import { createCounterOrderAction } from "./counterOrders";

const order: SubmitOrderInput = {
  slug: "loja-a",
  customerName: "Cliente Teste",
  customerPhone: "(11) 99999-0001",
  fulfillmentType: "pickup",
  delivery: null,
  paymentMethod: "pix",
  changeFor: null,
  observation: "",
  items: [{ product_id: "p1", quantity: 1, addon_ids: [], observation: "" }] as unknown as SubmitOrderInput["items"],
  idempotencyKey: "key-123",
  couponCode: null,
};

beforeEach(() => {
  h.publicRpc.mockReset();
  h.sessionRpc.mockReset();
  h.ipLimit.mockReset().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  h.storeLimit.mockReset().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
});

describe("submitOrderAction (checkout público)", () => {
  it("cria o pedido pelo caminho do servidor, repassando a chave de idempotência, e nunca pela sessão", async () => {
    h.publicRpc.mockResolvedValue({ data: [{ public_id: "pub-1", order_number: 7 }], error: null });
    const result = await submitOrderAction(order);
    expect(result).toEqual({ status: "success", publicId: "pub-1", orderNumber: 7 });
    expect(h.publicRpc).toHaveBeenCalledTimes(1);
    const [fn, args] = h.publicRpc.mock.calls[0];
    expect(fn).toBe("create_order");
    expect(args).toMatchObject({ p_slug: "loja-a", p_idempotency_key: "key-123", p_fulfillment_type: "pickup" });
    expect(h.sessionRpc).not.toHaveBeenCalled();
  });

  it("recusa tipo de entrega forjado (ex.: balcão) antes de qualquer limite ou chamada ao banco", async () => {
    const forged = { ...order, fulfillmentType: "counter" } as unknown as SubmitOrderInput;
    const result = await submitOrderAction(forged);
    expect(result.status).toBe("error");
    expect(h.ipLimit).not.toHaveBeenCalled();
    expect(h.publicRpc).not.toHaveBeenCalled();
  });

  it("limite por IP estourado: nada chega ao banco", async () => {
    h.ipLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 120 });
    const result = await submitOrderAction(order);
    expect(result.status).toBe("error");
    expect(h.publicRpc).not.toHaveBeenCalled();
  });

  it("limite por loja/telefone estourado: nada chega ao banco e a mensagem pede espera", async () => {
    h.storeLimit.mockImplementation(async (scope: string) =>
      scope === "pedido:fone" ? { allowed: false, retryAfterSeconds: 200 } : { allowed: true, retryAfterSeconds: 0 }
    );
    const result = await submitOrderAction(order);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.message).toMatch(/minutos?/);
    expect(h.publicRpc).not.toHaveBeenCalled();
  });

  it("slug inventado não cria baldes e o pedido segue para a validação do banco", async () => {
    h.publicRpc.mockResolvedValue({ data: null, error: { message: "restaurant_not_found" } });
    const result = await submitOrderAction({ ...order, slug: "../../x" });
    expect(result.status).toBe("error");
    expect(h.storeLimit).not.toHaveBeenCalled();
  });

  it("erro de retaguarda do banco vira mensagem amigável (sem texto cru)", async () => {
    h.publicRpc.mockResolvedValue({ data: null, error: { message: "order_rate_limited" } });
    const result = await submitOrderAction(order);
    expect(result).toEqual({ status: "error", message: expect.stringMatching(/muitos pedidos/i) });
  });

  it("servidor sem a chave administrativa: falha fechada com aviso claro", async () => {
    h.publicRpc.mockResolvedValue({ data: null, error: { message: "checkout_unavailable" } });
    const result = await submitOrderAction(order);
    expect(result).toEqual({ status: "error", message: expect.stringMatching(/indisponível/i) });
  });
});

describe("validateCouponAction", () => {
  it("valida pelo servidor depois dos limites", async () => {
    h.publicRpc.mockResolvedValue({
      data: [{ code: "PROMO10", discount_type: "percent", discount_value: "10", discount_amount: "5.00" }],
      error: null,
    });
    const result = await validateCouponAction("loja-a", "promo10", 50);
    expect(result).toMatchObject({ status: "success", code: "PROMO10", discountAmount: 5 });
    expect(h.publicRpc.mock.calls[0][0]).toBe("validate_coupon");
  });

  it("limite por loja estourado: o banco nem é consultado (adivinhar códigos não passa)", async () => {
    h.storeLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
    const result = await validateCouponAction("loja-a", "x", 50);
    expect(result.status).toBe("error");
    expect(h.publicRpc).not.toHaveBeenCalled();
  });
});

describe("createCounterOrderAction (PDV, membro logado)", () => {
  it("usa a sessão do membro e create_counter_order, nunca o caminho do servidor", async () => {
    h.sessionRpc.mockResolvedValue({ data: [{ public_id: "pub-9", order_number: 3 }], error: null });
    const result = await createCounterOrderAction({
      customerName: "",
      customerPhone: "",
      paymentMethod: "cash",
      changeFor: null,
      observation: "",
      items: [],
      idempotencyKey: "k-counter",
      couponCode: null,
    });
    expect(result).toEqual({ status: "success", publicId: "pub-9", orderNumber: 3 });
    expect(h.sessionRpc.mock.calls[0][0]).toBe("create_counter_order");
    expect(h.sessionRpc.mock.calls[0][1]).toMatchObject({ p_slug: "loja-a", p_idempotency_key: "k-counter" });
    expect(h.publicRpc).not.toHaveBeenCalled();
  });
});
