import { describe, expect, it } from "vitest";
import {
  COMBO_ITEM_QUANTITY_MAX,
  validateComboDescription,
  validateComboDraftItems,
  validateComboItemQuantity,
  validateComboName,
  validateComboPrice,
} from "./combos";

describe("validateComboName — TESTE 1 (válido) e TESTE 2 (vazio)", () => {
  it("TESTE 1: aceita um nome válido", () => {
    expect(validateComboName("Combo Casal")).toEqual({ ok: true });
  });

  it("TESTE 2: rejeita nome vazio", () => {
    expect(validateComboName("").ok).toBe(false);
  });

  it("rejeita nome só com espaços", () => {
    expect(validateComboName("   ").ok).toBe(false);
  });

  it("rejeita nome muito longo", () => {
    expect(validateComboName("a".repeat(81)).ok).toBe(false);
  });
});

describe("validateComboDescription", () => {
  it("aceita descrição vazia (é opcional)", () => {
    expect(validateComboDescription("")).toEqual({ ok: true });
  });

  it("rejeita descrição muito longa", () => {
    expect(validateComboDescription("a".repeat(301)).ok).toBe(false);
  });
});

describe("validateComboPrice — TESTE 3 (preço zero) e TESTE 4 (preço negativo)", () => {
  it("aceita um preço válido", () => {
    expect(validateComboPrice("89,90")).toEqual({ ok: true, value: 89.9 });
  });

  it("aceita ponto decimal também", () => {
    expect(validateComboPrice("89.90")).toEqual({ ok: true, value: 89.9 });
  });

  it("TESTE 3: rejeita preço zero", () => {
    expect(validateComboPrice("0").ok).toBe(false);
    expect(validateComboPrice("0,00").ok).toBe(false);
  });

  it("TESTE 4: rejeita preço negativo", () => {
    expect(validateComboPrice("-10").ok).toBe(false);
  });

  it("rejeita valor não numérico", () => {
    expect(validateComboPrice("abc").ok).toBe(false);
  });

  it("rejeita vazio", () => {
    expect(validateComboPrice("").ok).toBe(false);
  });
});

describe("validateComboItemQuantity — TESTE 5 (zero), TESTE 6 (negativa), TESTE 7 (decimal)", () => {
  it("aceita quantidade válida", () => {
    expect(validateComboItemQuantity(2)).toEqual({ ok: true, value: 2 });
    expect(validateComboItemQuantity("2")).toEqual({ ok: true, value: 2 });
  });

  it("TESTE 5: rejeita quantidade zero", () => {
    expect(validateComboItemQuantity(0).ok).toBe(false);
  });

  it("TESTE 6: rejeita quantidade negativa", () => {
    expect(validateComboItemQuantity(-1).ok).toBe(false);
  });

  it("TESTE 7: rejeita quantidade decimal", () => {
    expect(validateComboItemQuantity(1.5).ok).toBe(false);
    expect(validateComboItemQuantity("1,5").ok).toBe(false);
  });

  it(`aceita o limite máximo (${COMBO_ITEM_QUANTITY_MAX})`, () => {
    expect(validateComboItemQuantity(COMBO_ITEM_QUANTITY_MAX).ok).toBe(true);
  });

  it(`rejeita acima do limite máximo (${COMBO_ITEM_QUANTITY_MAX})`, () => {
    expect(validateComboItemQuantity(COMBO_ITEM_QUANTITY_MAX + 1).ok).toBe(false);
  });

  it("rejeita valor não numérico", () => {
    expect(validateComboItemQuantity("abc").ok).toBe(false);
  });
});

describe("validateComboDraftItems — TESTE 8 (combo sem produtos), TESTE 9 (item válido), TESTE 10 (produto duplicado)", () => {
  it("TESTE 8: rejeita combo sem nenhum produto", () => {
    const result = validateComboDraftItems([]);
    expect(result.ok).toBe(false);
  });

  it("TESTE 9: aceita uma composição válida", () => {
    expect(
      validateComboDraftItems([
        { productId: "p1", quantity: 2 },
        { productId: "p2", quantity: 1 },
      ])
    ).toEqual({ ok: true });
  });

  it("TESTE 10: rejeita produto duplicado na mesma composição", () => {
    const result = validateComboDraftItems([
      { productId: "p1", quantity: 1 },
      { productId: "p1", quantity: 1 },
    ]);
    expect(result.ok).toBe(false);
  });

  it("rejeita quando algum item tem quantidade inválida", () => {
    const result = validateComboDraftItems([{ productId: "p1", quantity: 0 }]);
    expect(result.ok).toBe(false);
  });
});
