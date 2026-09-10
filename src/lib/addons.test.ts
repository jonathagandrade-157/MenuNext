import { describe, expect, it } from "vitest";
import {
  ADDON_GROUP_MAX_SELECTIONS_LIMIT,
  describeAddonGroupRules,
  validateAddonGroupDescription,
  validateAddonGroupName,
  validateAddonGroupSelectionRules,
  validateAddonDescription,
  validateAddonName,
  validateAddonPrice,
} from "./addons";

describe("validateAddonGroupName — TESTE 1 (válido) e TESTE 2 (vazio)", () => {
  it("TESTE 1: aceita um nome de grupo válido", () => {
    expect(validateAddonGroupName("Borda recheada")).toEqual({ ok: true });
  });

  it("TESTE 2: rejeita nome vazio", () => {
    expect(validateAddonGroupName("").ok).toBe(false);
  });

  it("rejeita nome só com espaços", () => {
    expect(validateAddonGroupName("   ").ok).toBe(false);
  });

  it("rejeita nome muito longo", () => {
    expect(validateAddonGroupName("a".repeat(81)).ok).toBe(false);
  });
});

describe("validateAddonGroupDescription", () => {
  it("aceita descrição vazia (é opcional)", () => {
    expect(validateAddonGroupDescription("")).toEqual({ ok: true });
  });

  it("rejeita descrição muito longa", () => {
    expect(validateAddonGroupDescription("a".repeat(201)).ok).toBe(false);
  });
});

describe("validateAddonGroupSelectionRules — TESTE 3 (min inválido), TESTE 4 (max inválido), TESTE 5 (min>max), TESTE 6 (obrigatório sem mínimo), TESTE 7 (limite de máximo)", () => {
  it("aceita regras coerentes (min 1, max 3, opcional)", () => {
    expect(validateAddonGroupSelectionRules(1, 3, false)).toEqual({
      ok: true,
      minSelections: 1,
      maxSelections: 3,
      isRequired: false,
    });
  });

  it("TESTE 3: rejeita mínimo negativo", () => {
    expect(validateAddonGroupSelectionRules(-1, 3, false).ok).toBe(false);
  });

  it("TESTE 4: rejeita máximo menor que 1", () => {
    expect(validateAddonGroupSelectionRules(0, 0, false).ok).toBe(false);
  });

  it(`TESTE 4b: rejeita máximo acima do limite (${ADDON_GROUP_MAX_SELECTIONS_LIMIT})`, () => {
    expect(validateAddonGroupSelectionRules(0, ADDON_GROUP_MAX_SELECTIONS_LIMIT + 1, false).ok).toBe(false);
  });

  it(`TESTE 7: aceita máximo exatamente no limite (${ADDON_GROUP_MAX_SELECTIONS_LIMIT})`, () => {
    expect(validateAddonGroupSelectionRules(0, ADDON_GROUP_MAX_SELECTIONS_LIMIT, false).ok).toBe(true);
  });

  it("TESTE 5: rejeita mínimo maior que máximo", () => {
    expect(validateAddonGroupSelectionRules(5, 2, false).ok).toBe(false);
  });

  it("TESTE 6: rejeita grupo obrigatório com mínimo 0", () => {
    expect(validateAddonGroupSelectionRules(0, 2, true).ok).toBe(false);
  });

  it("aceita grupo obrigatório com mínimo >= 1", () => {
    expect(validateAddonGroupSelectionRules(1, 2, true).ok).toBe(true);
  });
});

describe("validateAddonName", () => {
  it("aceita um nome válido", () => {
    expect(validateAddonName("Catupiry")).toEqual({ ok: true });
  });

  it("rejeita nome vazio", () => {
    expect(validateAddonName("").ok).toBe(false);
  });

  it("rejeita nome muito longo", () => {
    expect(validateAddonName("a".repeat(81)).ok).toBe(false);
  });
});

describe("validateAddonDescription", () => {
  it("aceita descrição vazia (é opcional)", () => {
    expect(validateAddonDescription("")).toEqual({ ok: true });
  });

  it("rejeita descrição muito longa", () => {
    expect(validateAddonDescription("a".repeat(201)).ok).toBe(false);
  });
});

describe("validateAddonPrice — TESTE 8 (válido), TESTE 9 (negativo), TESTE 10 (zero)", () => {
  it("TESTE 8: aceita um preço válido", () => {
    expect(validateAddonPrice("4,50")).toEqual({ ok: true, value: 4.5 });
  });

  it("aceita ponto decimal também", () => {
    expect(validateAddonPrice("4.50")).toEqual({ ok: true, value: 4.5 });
  });

  it("TESTE 9: rejeita preço negativo", () => {
    expect(validateAddonPrice("-1,00").ok).toBe(false);
  });

  it("TESTE 10: aceita preço zero", () => {
    expect(validateAddonPrice("0")).toEqual({ ok: true, value: 0 });
    expect(validateAddonPrice("0,00")).toEqual({ ok: true, value: 0 });
  });

  it("rejeita valor não numérico", () => {
    expect(validateAddonPrice("abc").ok).toBe(false);
  });

  it("rejeita vazio", () => {
    expect(validateAddonPrice("").ok).toBe(false);
  });
});

describe("describeAddonGroupRules", () => {
  it("descreve grupo de escolha única obrigatória", () => {
    expect(describeAddonGroupRules({ min_selections: 1, max_selections: 1, is_required: true })).toBe(
      "Escolha 1 opção · Obrigatório"
    );
  });

  it("descreve grupo opcional de múltipla escolha com mínimo 0", () => {
    expect(describeAddonGroupRules({ min_selections: 0, max_selections: 3, is_required: false })).toBe(
      "Escolha até 3 opções · Opcional"
    );
  });

  it("descreve grupo com faixa mínimo/máximo", () => {
    expect(describeAddonGroupRules({ min_selections: 1, max_selections: 3, is_required: false })).toBe(
      "Escolha de 1 a 3 opções · Opcional"
    );
  });
});
