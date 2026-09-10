import { describe, expect, it } from "vitest";
import {
  CATEGORY_DESCRIPTION_MAX_LENGTH,
  CATEGORY_NAME_MAX_LENGTH,
  isSameCategoryName,
  normalizeCategoryName,
  validateCategoryDescription,
  validateCategoryName,
} from "./categories";

describe("normalizeCategoryName", () => {
  it("remove espaços nas pontas", () => {
    expect(normalizeCategoryName("  Bebidas  ")).toBe("Bebidas");
  });
});

describe("validateCategoryName — TESTE 1 (válida) e TESTE 2 (vazia)", () => {
  it("TESTE 1: aceita um nome válido", () => {
    expect(validateCategoryName("Hambúrgueres")).toEqual({ ok: true });
  });

  it("TESTE 2: rejeita nome vazio", () => {
    const result = validateCategoryName("");
    expect(result.ok).toBe(false);
  });

  it("rejeita nome só com espaços", () => {
    const result = validateCategoryName("    ");
    expect(result.ok).toBe(false);
  });

  it(`rejeita nome com mais de ${CATEGORY_NAME_MAX_LENGTH} caracteres`, () => {
    const result = validateCategoryName("a".repeat(CATEGORY_NAME_MAX_LENGTH + 1));
    expect(result.ok).toBe(false);
  });

  it(`aceita nome com exatamente ${CATEGORY_NAME_MAX_LENGTH} caracteres`, () => {
    const result = validateCategoryName("a".repeat(CATEGORY_NAME_MAX_LENGTH));
    expect(result.ok).toBe(true);
  });
});

describe("validateCategoryDescription", () => {
  it("aceita descrição vazia (é opcional)", () => {
    expect(validateCategoryDescription("")).toEqual({ ok: true });
  });

  it(`rejeita descrição com mais de ${CATEGORY_DESCRIPTION_MAX_LENGTH} caracteres`, () => {
    const result = validateCategoryDescription("a".repeat(CATEGORY_DESCRIPTION_MAX_LENGTH + 1));
    expect(result.ok).toBe(false);
  });
});

describe("isSameCategoryName — TESTE 3 (duplicidade ignorando maiúsculas/espaços)", () => {
  it("TESTE 3: reconhece 'Bebidas' e '  bebidas ' como o mesmo nome", () => {
    expect(isSameCategoryName("Bebidas", "  bebidas ")).toBe(true);
  });

  it("reconhece nomes realmente diferentes como diferentes", () => {
    expect(isSameCategoryName("Bebidas", "Sobremesas")).toBe(false);
  });

  it(
    "TESTE 4 (documentação): a função de comparação de nome, sozinha, não " +
      "sabe nada sobre restaurant_id — permitir 'Hambúrgueres' em dois " +
      "restaurantes diferentes é responsabilidade do índice único " +
      "(restaurant_id, lower(trim(name))) no banco (migration " +
      "add_categories.sql), verificado ao vivo contra o Supabase (ver " +
      "relatório da Fase 2.1), não desta função pura.",
    () => {
      expect(isSameCategoryName("Hambúrgueres", "Hambúrgueres")).toBe(true);
    }
  );
});
