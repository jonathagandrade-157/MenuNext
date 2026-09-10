/**
 * Regras puras de validação de categoria do cardápio — compartilhadas pelo
 * Server Action (src/lib/actions/categories.ts) e pelos testes. A garantia
 * real e à prova de concorrência (duplicidade, tamanho) é sempre repetida
 * no banco (CHECK constraints + índice único em `categories`,
 * migration add_categories.sql) — isto aqui é a camada de UX, que dá um
 * erro cedo e com a mesma regra usada no servidor.
 */

export const CATEGORY_NAME_MAX_LENGTH = 80;
export const CATEGORY_DESCRIPTION_MAX_LENGTH = 200;

export function normalizeCategoryName(name: string): string {
  return name.trim();
}

/** Normaliza para comparação de duplicidade: minúsculas + sem espaços nas pontas. */
export function normalizeCategoryNameForComparison(name: string): string {
  return name.trim().toLowerCase();
}

export function isSameCategoryName(a: string, b: string): boolean {
  return normalizeCategoryNameForComparison(a) === normalizeCategoryNameForComparison(b);
}

export type FieldValidation = { ok: true } | { ok: false; error: string };

export function validateCategoryName(rawName: string): FieldValidation {
  const name = normalizeCategoryName(rawName);
  if (!name) return { ok: false, error: "Informe o nome da categoria." };
  if (name.length > CATEGORY_NAME_MAX_LENGTH) {
    return { ok: false, error: `O nome deve ter até ${CATEGORY_NAME_MAX_LENGTH} caracteres.` };
  }
  return { ok: true };
}

export function validateCategoryDescription(rawDescription: string): FieldValidation {
  const description = rawDescription.trim();
  if (description.length > CATEGORY_DESCRIPTION_MAX_LENGTH) {
    return { ok: false, error: `A descrição deve ter até ${CATEGORY_DESCRIPTION_MAX_LENGTH} caracteres.` };
  }
  return { ok: true };
}
