import { describe, expect, it } from "vitest";
import {
  CHECKOUT_OBSERVATION_MAX_LENGTH,
  CUSTOMER_NAME_MAX_LENGTH,
  buildOrderItemsPayload,
  generateIdempotencyKey,
  validateChangeFor,
  validateCheckoutObservation,
  validateCustomerName,
  validateCustomerPhone,
  validateDeliveryAddress,
} from "./checkout";
import type { BagItem } from "./bag";

describe("validateCustomerName — TESTE A (válido) / TESTE B (nome ausente)", () => {
  it("TESTE A: aceita nome válido", () => {
    expect(validateCustomerName("Maria Silva")).toEqual({ ok: true });
  });

  it("TESTE B: rejeita nome vazio ou só espaços", () => {
    expect(validateCustomerName("").ok).toBe(false);
    expect(validateCustomerName("   ").ok).toBe(false);
  });

  it(`rejeita nome com mais de ${CUSTOMER_NAME_MAX_LENGTH} caracteres`, () => {
    expect(validateCustomerName("a".repeat(CUSTOMER_NAME_MAX_LENGTH + 1)).ok).toBe(false);
  });

  it(`aceita nome com exatamente ${CUSTOMER_NAME_MAX_LENGTH} caracteres`, () => {
    expect(validateCustomerName("a".repeat(CUSTOMER_NAME_MAX_LENGTH)).ok).toBe(true);
  });
});

describe("validateCustomerPhone — TESTE C (telefone ausente/inválido)", () => {
  it("aceita telefone válido com ou sem formatação", () => {
    expect(validateCustomerPhone("11987654321")).toEqual({ ok: true });
    expect(validateCustomerPhone("(11) 98765-4321")).toEqual({ ok: true });
    expect(validateCustomerPhone("1132654321")).toEqual({ ok: true }); // fixo, 10 dígitos
  });

  it("TESTE C: rejeita telefone vazio", () => {
    expect(validateCustomerPhone("").ok).toBe(false);
  });

  it("TESTE C: rejeita telefone com poucos dígitos", () => {
    expect(validateCustomerPhone("1234567").ok).toBe(false);
  });

  it("TESTE C: rejeita telefone com dígitos demais", () => {
    expect(validateCustomerPhone("119876543210").ok).toBe(false);
  });
});

describe("validateDeliveryAddress — TESTE D (entrega sem endereço)", () => {
  const valid = {
    zip: "01310-100",
    street: "Rua das Flores",
    number: "123",
    neighborhood: "Centro",
    city: "São Paulo",
    state: "SP",
  };

  it("aceita endereço completo", () => {
    expect(validateDeliveryAddress(valid)).toEqual({ ok: true });
  });

  it("TESTE D: rejeita sem CEP (ou CEP incompleto)", () => {
    expect(validateDeliveryAddress({ ...valid, zip: "" }).ok).toBe(false);
    expect(validateDeliveryAddress({ ...valid, zip: "01310" }).ok).toBe(false);
  });

  it("TESTE D: rejeita sem rua", () => {
    expect(validateDeliveryAddress({ ...valid, street: "" }).ok).toBe(false);
  });

  it("TESTE D: rejeita sem número", () => {
    expect(validateDeliveryAddress({ ...valid, number: "" }).ok).toBe(false);
  });

  it("TESTE D: rejeita sem bairro", () => {
    expect(validateDeliveryAddress({ ...valid, neighborhood: "" }).ok).toBe(false);
  });

  it("TESTE D: rejeita sem cidade", () => {
    expect(validateDeliveryAddress({ ...valid, city: "" }).ok).toBe(false);
  });

  it("TESTE D: rejeita sem estado", () => {
    expect(validateDeliveryAddress({ ...valid, state: "" }).ok).toBe(false);
  });
});

describe("validateChangeFor — TESTE G (dinheiro com troco inválido)", () => {
  it("aceita null (sem troco / valor exato)", () => {
    expect(validateChangeFor(null, 50)).toEqual({ ok: true });
  });

  it("aceita troco maior ou igual ao total", () => {
    expect(validateChangeFor(50, 50)).toEqual({ ok: true });
    expect(validateChangeFor(100, 50)).toEqual({ ok: true });
  });

  it("TESTE G: rejeita troco menor que o total", () => {
    expect(validateChangeFor(20, 50).ok).toBe(false);
  });

  it("TESTE G: rejeita troco negativo", () => {
    expect(validateChangeFor(-10, 50).ok).toBe(false);
  });
});

describe("validateCheckoutObservation", () => {
  it("aceita observação vazia (opcional)", () => {
    expect(validateCheckoutObservation("")).toEqual({ ok: true });
  });

  it(`rejeita observação com mais de ${CHECKOUT_OBSERVATION_MAX_LENGTH} caracteres`, () => {
    expect(validateCheckoutObservation("a".repeat(CHECKOUT_OBSERVATION_MAX_LENGTH + 1)).ok).toBe(false);
  });
});

describe("buildOrderItemsPayload — nunca inclui preço/subtotal, só a intenção de compra", () => {
  it("mapeia itens da sacola para o payload da RPC create_order", () => {
    const items: BagItem[] = [
      {
        key: "p1::a1,a2::",
        productId: "p1",
        name: "Produto 1",
        basePrice: 20,
        imageUrl: null,
        quantity: 2,
        observation: "sem cebola",
        selectedAddons: [
          { groupId: "g1", addonId: "a1", name: "Addon 1", price: 2 },
          { groupId: "g1", addonId: "a2", name: "Addon 2", price: 3 },
        ],
        subtotal: 50,
      },
    ];

    expect(buildOrderItemsPayload(items)).toEqual([
      { product_id: "p1", quantity: 2, observation: "sem cebola", addon_ids: ["a1", "a2"] },
    ]);
  });

  it("observação vazia vira null", () => {
    const items: BagItem[] = [
      {
        key: "p1::::",
        productId: "p1",
        name: "Produto 1",
        basePrice: 20,
        imageUrl: null,
        quantity: 1,
        observation: "",
        selectedAddons: [],
        subtotal: 20,
      },
    ];
    expect(buildOrderItemsPayload(items)[0].observation).toBeNull();
  });

  it("nunca inclui campos de preço no payload", () => {
    const items: BagItem[] = [
      {
        key: "p1::::",
        productId: "p1",
        name: "Produto 1",
        basePrice: 999,
        imageUrl: null,
        quantity: 1,
        observation: "",
        selectedAddons: [],
        subtotal: 0.01,
      },
    ];
    const payload = buildOrderItemsPayload(items)[0] as Record<string, unknown>;
    expect(payload.price).toBeUndefined();
    expect(payload.subtotal).toBeUndefined();
    expect(payload.basePrice).toBeUndefined();
  });
});

describe("generateIdempotencyKey", () => {
  it("gera chaves diferentes a cada chamada", () => {
    const a = generateIdempotencyKey();
    const b = generateIdempotencyKey();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
