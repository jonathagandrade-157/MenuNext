import { describe, expect, it } from "vitest";
import {
  PRODUCT_DESCRIPTION_MAX_LENGTH,
  PRODUCT_NAME_MAX_LENGTH,
  formatCurrencyBRL,
  validateProductCost,
  validateProductDescription,
  validateProductName,
  validateProductPrice,
} from "./products";

describe("validateProductName — TESTE 1 (válido), TESTE 2 (vazio), TESTE 3 (limite)", () => {
  it("TESTE 1: aceita nome válido", () => {
    expect(validateProductName("Pizza Calabresa")).toEqual({ ok: true });
  });

  it("TESTE 2: rejeita nome vazio", () => {
    expect(validateProductName("").ok).toBe(false);
    expect(validateProductName("   ").ok).toBe(false);
  });

  it(`TESTE 3: rejeita nome com mais de ${PRODUCT_NAME_MAX_LENGTH} caracteres`, () => {
    expect(validateProductName("a".repeat(PRODUCT_NAME_MAX_LENGTH + 1)).ok).toBe(false);
  });

  it(`aceita nome com exatamente ${PRODUCT_NAME_MAX_LENGTH} caracteres`, () => {
    expect(validateProductName("a".repeat(PRODUCT_NAME_MAX_LENGTH)).ok).toBe(true);
  });
});

describe("validateProductDescription — TESTE 4 (limite)", () => {
  it("aceita descrição vazia (opcional)", () => {
    expect(validateProductDescription("")).toEqual({ ok: true });
  });

  it(`TESTE 4: rejeita descrição com mais de ${PRODUCT_DESCRIPTION_MAX_LENGTH} caracteres`, () => {
    expect(validateProductDescription("a".repeat(PRODUCT_DESCRIPTION_MAX_LENGTH + 1)).ok).toBe(false);
  });
});

describe("validateProductPrice — TESTE 5 (zero) e TESTE 6 (negativo)", () => {
  it("aceita preço válido, com ponto ou vírgula", () => {
    expect(validateProductPrice("45.90")).toEqual({ ok: true, value: 45.9 });
    expect(validateProductPrice("45,90")).toEqual({ ok: true, value: 45.9 });
  });

  it("TESTE 5: rejeita preço zero", () => {
    expect(validateProductPrice("0").ok).toBe(false);
    expect(validateProductPrice("0,00").ok).toBe(false);
  });

  it("TESTE 6: rejeita preço negativo", () => {
    expect(validateProductPrice("-10").ok).toBe(false);
  });

  it("rejeita preço vazio ou não numérico", () => {
    expect(validateProductPrice("").ok).toBe(false);
    expect(validateProductPrice("abc").ok).toBe(false);
  });
});

describe("validateProductCost — TESTE 7 (negativo)", () => {
  it("aceita custo vazio (opcional) como null", () => {
    expect(validateProductCost("")).toEqual({ ok: true, value: null });
  });

  it("aceita custo válido", () => {
    expect(validateProductCost("18,00")).toEqual({ ok: true, value: 18 });
  });

  it("TESTE 7: rejeita custo negativo", () => {
    expect(validateProductCost("-5").ok).toBe(false);
  });

  it("aceita custo zero (produto de brinde/cortesia)", () => {
    expect(validateProductCost("0")).toEqual({ ok: true, value: 0 });
  });
});

describe("formatCurrencyBRL", () => {
  it("formata como moeda brasileira", () => {
    expect(formatCurrencyBRL(45.9)).toContain("45,90");
  });
});
