/**
 * Regras puras de validação de produto do cardápio — compartilhadas pelo
 * Server Action (src/lib/actions/products.ts) e pelos testes. A garantia
 * real (preço > 0, custo >= 0, tamanhos, categoria do mesmo restaurante) é
 * sempre repetida no banco (CHECK constraints + FK composta, migration
 * add_products_category_and_fields.sql) — isto aqui é a camada de UX.
 */

export const PRODUCT_NAME_MAX_LENGTH = 120;
export const PRODUCT_DESCRIPTION_MAX_LENGTH = 500;

export type FieldValidation = { ok: true } | { ok: false; error: string };

export function normalizeProductName(name: string): string {
  return name.trim();
}

export function validateProductName(rawName: string): FieldValidation {
  const name = normalizeProductName(rawName);
  if (!name) return { ok: false, error: "Informe o nome do produto." };
  if (name.length > PRODUCT_NAME_MAX_LENGTH) {
    return { ok: false, error: `O nome deve ter até ${PRODUCT_NAME_MAX_LENGTH} caracteres.` };
  }
  return { ok: true };
}

export function validateProductDescription(rawDescription: string): FieldValidation {
  const description = rawDescription.trim();
  if (description.length > PRODUCT_DESCRIPTION_MAX_LENGTH) {
    return { ok: false, error: `A descrição deve ter até ${PRODUCT_DESCRIPTION_MAX_LENGTH} caracteres.` };
  }
  return { ok: true };
}

/** Aceita tanto "12.90" quanto "12,90" (teclado numérico BR). */
export function parseMoneyInput(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export type PriceValidation = { ok: true; value: number } | { ok: false; error: string };

export function validateProductPrice(raw: string): PriceValidation {
  const value = parseMoneyInput(raw);
  if (value === null) return { ok: false, error: "Informe um preço válido." };
  if (value <= 0) return { ok: false, error: "O preço deve ser maior que zero." };
  return { ok: true, value };
}

export type CostValidation = { ok: true; value: number | null } | { ok: false; error: string };

/** Custo é opcional — string vazia é válida e vira null. */
export function validateProductCost(raw: string): CostValidation {
  if (!raw.trim()) return { ok: true, value: null };
  const value = parseMoneyInput(raw);
  if (value === null) return { ok: false, error: "Informe um custo válido." };
  if (value < 0) return { ok: false, error: "O custo não pode ser negativo." };
  return { ok: true, value };
}

export function formatCurrencyBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
