/**
 * Regras puras de validação de combos (composição por produtos existentes)
 * — compartilhadas pelo Server Action (src/lib/actions/combos.ts) e pelos
 * testes. A garantia real (preço > 0, quantidade 1..99, produto do mesmo
 * tenant) é sempre repetida no banco (CHECK constraints + FK composta,
 * migration add_combos.sql) — isto aqui é a camada de UX.
 */

export const COMBO_NAME_MAX_LENGTH = 80;
export const COMBO_DESCRIPTION_MAX_LENGTH = 300;
export const COMBO_ITEM_QUANTITY_MAX = 99;

export type FieldValidation = { ok: true } | { ok: false; error: string };

export function normalizeComboName(name: string): string {
  return name.trim();
}

export function validateComboName(rawName: string): FieldValidation {
  const name = normalizeComboName(rawName);
  if (!name) return { ok: false, error: "Informe o nome do combo." };
  if (name.length > COMBO_NAME_MAX_LENGTH) {
    return { ok: false, error: `O nome deve ter até ${COMBO_NAME_MAX_LENGTH} caracteres.` };
  }
  return { ok: true };
}

export function validateComboDescription(rawDescription: string): FieldValidation {
  const description = rawDescription.trim();
  if (description.length > COMBO_DESCRIPTION_MAX_LENGTH) {
    return { ok: false, error: `A descrição deve ter até ${COMBO_DESCRIPTION_MAX_LENGTH} caracteres.` };
  }
  return { ok: true };
}

/** Aceita tanto "89.90" quanto "89,90" (teclado numérico BR) — mesmo parser de products.ts. */
export function parseMoneyInput(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export type ComboPriceValidation = { ok: true; value: number } | { ok: false; error: string };

/** Preço do combo é definido pelo lojista — nunca calculado pela soma dos produtos. */
export function validateComboPrice(raw: string): ComboPriceValidation {
  const value = parseMoneyInput(raw);
  if (value === null) return { ok: false, error: "Informe um preço válido." };
  if (value <= 0) return { ok: false, error: "O preço do combo deve ser maior que zero." };
  return { ok: true, value };
}

export type ComboQuantityValidation = { ok: true; value: number } | { ok: false; error: string };

/** Quantidade de um produto dentro do combo: inteiro entre 1 e 99. */
export function validateComboItemQuantity(raw: string | number): ComboQuantityValidation {
  const value = typeof raw === "number" ? raw : Number(raw.trim().replace(",", "."));
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return { ok: false, error: "A quantidade deve ser um número inteiro." };
  }
  if (value < 1) return { ok: false, error: "A quantidade mínima é 1." };
  if (value > COMBO_ITEM_QUANTITY_MAX) {
    return { ok: false, error: `A quantidade máxima é ${COMBO_ITEM_QUANTITY_MAX}.` };
  }
  return { ok: true, value };
}

export function formatCurrencyBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export type ComboDraftItem = { productId: string; quantity: number };

/**
 * Valida a composição informada na criação de um combo: pelo menos 1
 * produto, sem produto duplicado, quantidades todas válidas. A checagem de
 * que cada produto realmente pertence ao restaurante é feita no servidor
 * (RPC add_combo_item), não aqui — isto é só a forma dos dados do formulário.
 */
export function validateComboDraftItems(items: ComboDraftItem[]): FieldValidation {
  if (items.length === 0) {
    return { ok: false, error: "Adicione pelo menos um produto ao combo." };
  }
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.productId) return { ok: false, error: "Selecione um produto válido para cada item." };
    if (seen.has(item.productId)) {
      return { ok: false, error: "Não é possível adicionar o mesmo produto duas vezes no combo." };
    }
    seen.add(item.productId);
    const quantityValidation = validateComboItemQuantity(item.quantity);
    if (!quantityValidation.ok) return quantityValidation;
  }
  return { ok: true };
}
