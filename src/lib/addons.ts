/**
 * Regras puras de validação de adicionais (grupos + itens) — compartilhadas
 * pelo Server Action (src/lib/actions/addons.ts) e pelos testes. A garantia
 * real (min/max/obrigatório coerentes, preço >= 0, grupo do mesmo tenant) é
 * sempre repetida no banco (CHECK constraints + FK composta, migration
 * add_addon_groups_and_addons.sql) — isto aqui é a camada de UX, que dá um
 * erro cedo e com a mesma regra usada no servidor.
 */

export const ADDON_GROUP_NAME_MAX_LENGTH = 80;
export const ADDON_GROUP_DESCRIPTION_MAX_LENGTH = 200;
export const ADDON_NAME_MAX_LENGTH = 80;
export const ADDON_DESCRIPTION_MAX_LENGTH = 200;
export const ADDON_GROUP_MAX_SELECTIONS_LIMIT = 20;

export type FieldValidation = { ok: true } | { ok: false; error: string };

export function normalizeAddonName(name: string): string {
  return name.trim();
}

export function validateAddonGroupName(rawName: string): FieldValidation {
  const name = normalizeAddonName(rawName);
  if (!name) return { ok: false, error: "Informe o nome do grupo." };
  if (name.length > ADDON_GROUP_NAME_MAX_LENGTH) {
    return { ok: false, error: `O nome deve ter até ${ADDON_GROUP_NAME_MAX_LENGTH} caracteres.` };
  }
  return { ok: true };
}

export function validateAddonGroupDescription(rawDescription: string): FieldValidation {
  const description = rawDescription.trim();
  if (description.length > ADDON_GROUP_DESCRIPTION_MAX_LENGTH) {
    return { ok: false, error: `A descrição deve ter até ${ADDON_GROUP_DESCRIPTION_MAX_LENGTH} caracteres.` };
  }
  return { ok: true };
}

export type SelectionRulesValidation =
  | { ok: true; minSelections: number; maxSelections: number; isRequired: boolean }
  | { ok: false; error: string };

/**
 * Valida a coerência das regras de seleção de um grupo: mínimo/máximo dentro
 * dos limites, mínimo <= máximo, e "obrigatório" nunca com mínimo 0 (regra
 * repetida no banco via CHECK — aqui só antecipa o erro pro usuário).
 */
export function validateAddonGroupSelectionRules(
  rawMin: number,
  rawMax: number,
  isRequired: boolean
): SelectionRulesValidation {
  if (!Number.isInteger(rawMin) || rawMin < 0) {
    return { ok: false, error: "O mínimo de seleções deve ser um número inteiro maior ou igual a zero." };
  }
  if (!Number.isInteger(rawMax) || rawMax < 1 || rawMax > ADDON_GROUP_MAX_SELECTIONS_LIMIT) {
    return {
      ok: false,
      error: `O máximo de seleções deve ser um número entre 1 e ${ADDON_GROUP_MAX_SELECTIONS_LIMIT}.`,
    };
  }
  if (rawMin > rawMax) {
    return { ok: false, error: "O mínimo de seleções não pode ser maior que o máximo." };
  }
  if (isRequired && rawMin < 1) {
    return { ok: false, error: "Um grupo obrigatório precisa de um mínimo de seleções de pelo menos 1." };
  }
  return { ok: true, minSelections: rawMin, maxSelections: rawMax, isRequired };
}

export function validateAddonName(rawName: string): FieldValidation {
  const name = normalizeAddonName(rawName);
  if (!name) return { ok: false, error: "Informe o nome do adicional." };
  if (name.length > ADDON_NAME_MAX_LENGTH) {
    return { ok: false, error: `O nome deve ter até ${ADDON_NAME_MAX_LENGTH} caracteres.` };
  }
  return { ok: true };
}

export function validateAddonDescription(rawDescription: string): FieldValidation {
  const description = rawDescription.trim();
  if (description.length > ADDON_DESCRIPTION_MAX_LENGTH) {
    return { ok: false, error: `A descrição deve ter até ${ADDON_DESCRIPTION_MAX_LENGTH} caracteres.` };
  }
  return { ok: true };
}

export type AddonPriceValidation = { ok: true; value: number } | { ok: false; error: string };

/** Preço adicional: aceita zero, nunca negativo — nunca confiar em valor calculado no cliente. */
export function validateAddonPrice(raw: string): AddonPriceValidation {
  const normalized = raw.trim().replace(",", ".");
  if (!normalized) return { ok: false, error: "Informe o preço adicional (pode ser 0,00)." };
  const value = Number(normalized);
  if (!Number.isFinite(value)) return { ok: false, error: "Informe um preço válido." };
  if (value < 0) return { ok: false, error: "O preço adicional não pode ser negativo." };
  return { ok: true, value };
}

/** Resumo textual das regras de seleção de um grupo, para exibição na lista. */
export function describeAddonGroupRules(group: {
  min_selections: number;
  max_selections: number;
  is_required: boolean;
}): string {
  const requiredLabel = group.is_required ? "Obrigatório" : "Opcional";
  if (group.max_selections === 1) {
    return group.min_selections >= 1 ? `Escolha 1 opção · ${requiredLabel}` : `Escolha até 1 opção · ${requiredLabel}`;
  }
  if (group.min_selections === 0) {
    return `Escolha até ${group.max_selections} opções · ${requiredLabel}`;
  }
  return `Escolha de ${group.min_selections} a ${group.max_selections} opções · ${requiredLabel}`;
}
