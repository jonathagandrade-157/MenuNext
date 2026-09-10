import { describe, expect, it } from "vitest";
import {
  BAG_ITEM_QUANTITY_MAX,
  buildBagItemKey,
  calculateItemSubtotal,
  createBagItem,
  validateAllGroupsSelection,
  validateBagItemObservation,
  validateBagItemQuantity,
  validateGroupSelection,
  type BagAddonGroupForSelection,
} from "./bag";

const cheeseGroup: BagAddonGroupForSelection = {
  id: "g1",
  name: "Escolha seu queijo",
  min_selections: 1,
  max_selections: 1,
  is_required: true,
  addons: [
    { id: "a1", name: "Cheddar", price: 3 },
    { id: "a2", name: "Catupiry", price: 4 },
  ],
};

const extrasGroup: BagAddonGroupForSelection = {
  id: "g2",
  name: "Adicionais",
  min_selections: 0,
  max_selections: 3,
  is_required: false,
  addons: [
    { id: "a3", name: "Bacon", price: 5 },
    { id: "a4", name: "Ovo", price: 2 },
    { id: "a5", name: "Cebola caramelizada", price: 3 },
  ],
};

describe("validateBagItemQuantity — TESTE 13 (quantidade)", () => {
  it("aceita quantidade válida", () => {
    expect(validateBagItemQuantity(1)).toEqual({ ok: true });
    expect(validateBagItemQuantity(BAG_ITEM_QUANTITY_MAX)).toEqual({ ok: true });
  });

  it("rejeita quantidade zero", () => {
    expect(validateBagItemQuantity(0).ok).toBe(false);
  });

  it("rejeita quantidade negativa", () => {
    expect(validateBagItemQuantity(-1).ok).toBe(false);
  });

  it("rejeita quantidade decimal", () => {
    expect(validateBagItemQuantity(1.5).ok).toBe(false);
  });

  it("rejeita acima do máximo", () => {
    expect(validateBagItemQuantity(BAG_ITEM_QUANTITY_MAX + 1).ok).toBe(false);
  });
});

describe("validateBagItemObservation — TESTE 14 (observação)", () => {
  it("aceita observação vazia (é opcional)", () => {
    expect(validateBagItemObservation("")).toEqual({ ok: true });
  });

  it("aceita observação dentro do limite", () => {
    expect(validateBagItemObservation("Sem cebola, por favor")).toEqual({ ok: true });
  });

  it("rejeita observação muito longa", () => {
    expect(validateBagItemObservation("a".repeat(201)).ok).toBe(false);
  });
});

describe("validateGroupSelection — TESTE 7 (obrigatório), TESTE 8 (min), TESTE 9 (max)", () => {
  it("TESTE 7/8: grupo obrigatório (min=1,max=1) rejeita seleção vazia", () => {
    const result = validateGroupSelection(cheeseGroup, []);
    expect(result.ok).toBe(false);
  });

  it("aceita exatamente 1 seleção em grupo min=1,max=1", () => {
    expect(validateGroupSelection(cheeseGroup, ["a1"])).toEqual({ ok: true });
  });

  it("TESTE 9: rejeita mais de 1 seleção em grupo max=1", () => {
    const result = validateGroupSelection(cheeseGroup, ["a1", "a2"]);
    expect(result.ok).toBe(false);
  });

  it("grupo opcional (min=0) aceita seleção vazia", () => {
    expect(validateGroupSelection(extrasGroup, [])).toEqual({ ok: true });
  });

  it("aceita até o máximo do grupo opcional", () => {
    expect(validateGroupSelection(extrasGroup, ["a3", "a4", "a5"])).toEqual({ ok: true });
  });

  it("TESTE 9b: rejeita acima do máximo do grupo opcional", () => {
    const result = validateGroupSelection(extrasGroup, ["a3", "a4", "a5", "a3"]);
    expect(result.ok).toBe(false);
  });
});

describe("validateAllGroupsSelection — TESTE 18 (múltiplos grupos)", () => {
  it("rejeita quando o grupo obrigatório está vazio, mesmo com o opcional válido", () => {
    const result = validateAllGroupsSelection([cheeseGroup, extrasGroup], { g1: [], g2: ["a3"] });
    expect(result.ok).toBe(false);
  });

  it("aceita quando todos os grupos estão dentro das regras", () => {
    const result = validateAllGroupsSelection([cheeseGroup, extrasGroup], { g1: ["a1"], g2: ["a3", "a4"] });
    expect(result).toEqual({ ok: true });
  });

  it("TESTE 17: produto sem nenhum grupo é sempre válido", () => {
    expect(validateAllGroupsSelection([], {})).toEqual({ ok: true });
  });
});

describe("calculateItemSubtotal — TESTE 12 (cálculo de subtotal)", () => {
  it("soma base + adicionais e multiplica pela quantidade", () => {
    expect(calculateItemSubtotal(28.9, [{ price: 3 }, { price: 5 }], 2)).toBeCloseTo((28.9 + 3 + 5) * 2);
  });

  it("sem adicionais, é só base × quantidade", () => {
    expect(calculateItemSubtotal(10, [], 3)).toBe(30);
  });
});

describe("buildBagItemKey / createBagItem — TESTE 15 (adicionais diferentes) e TESTE 16 (observações diferentes)", () => {
  it("mesma combinação de adicionais e observação gera a mesma chave", () => {
    const keyA = buildBagItemKey("p1", ["a3", "a1"], "sem cebola");
    const keyB = buildBagItemKey("p1", ["a1", "a3"], "sem cebola");
    expect(keyA).toBe(keyB);
  });

  it("TESTE 15: adicionais diferentes geram chaves diferentes (itens coexistem)", () => {
    const keyBacon = buildBagItemKey("p1", ["a3"], "");
    const keyCheddar = buildBagItemKey("p1", ["a1"], "");
    expect(keyBacon).not.toBe(keyCheddar);
  });

  it("TESTE 16: observações diferentes geram chaves diferentes mesmo com os mesmos adicionais", () => {
    const keyA = buildBagItemKey("p1", ["a1"], "sem cebola");
    const keyB = buildBagItemKey("p1", ["a1"], "bem passado");
    expect(keyA).not.toBe(keyB);
  });

  it("createBagItem monta o item completo com subtotal e chave coerentes", () => {
    const item = createBagItem({
      productId: "p1",
      name: "X-Burger",
      basePrice: 20,
      imageUrl: null,
      quantity: 2,
      observation: "  sem cebola  ",
      selectedAddons: [{ groupId: "g2", addonId: "a3", name: "Bacon", price: 5 }],
    });
    expect(item.observation).toBe("sem cebola");
    expect(item.subtotal).toBe((20 + 5) * 2);
    expect(item.key).toBe(buildBagItemKey("p1", ["a3"], "sem cebola"));
  });
});
