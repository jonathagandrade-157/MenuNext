/**
 * Sacola (bag) da loja pública — inteiramente client-side/local nesta fase
 * (nenhuma tabela de carrinho no banco). Este módulo é puro (testável sem
 * DOM/localStorage): monta itens, calcula subtotal e valida as regras dos
 * grupos de adicionais (min/max/required) a partir dos dados REAIS já
 * carregados do produto — nunca inventa regra nova.
 *
 * O preço calculado aqui é só visual, para a experiência da sacola. A
 * criação segura do pedido (fase futura) deve recalcular tudo no servidor a
 * partir dos preços reais em banco — nunca confiar no subtotal calculado no
 * cliente.
 */

export const BAG_ITEM_OBSERVATION_MAX_LENGTH = 200;
export const BAG_ITEM_QUANTITY_MAX = 99;

export type BagAddonGroupOption = {
  id: string;
  name: string;
  price: number;
};

/** Forma mínima de um grupo de adicionais necessária para validar a seleção — reaproveita AddonGroupWithAddons de tenant.ts na prática. */
export type BagAddonGroupForSelection = {
  id: string;
  name: string;
  min_selections: number;
  max_selections: number;
  is_required: boolean;
  addons: BagAddonGroupOption[];
};

export type BagSelectedAddon = { groupId: string; addonId: string; name: string; price: number };

export type BagItem = {
  key: string;
  productId: string;
  name: string;
  basePrice: number;
  imageUrl: string | null;
  quantity: number;
  observation: string;
  selectedAddons: BagSelectedAddon[];
  subtotal: number;
};

export type FieldValidation = { ok: true } | { ok: false; error: string };

export function validateBagItemQuantity(quantity: number): FieldValidation {
  if (!Number.isInteger(quantity)) return { ok: false, error: "A quantidade deve ser um número inteiro." };
  if (quantity < 1) return { ok: false, error: "A quantidade mínima é 1." };
  if (quantity > BAG_ITEM_QUANTITY_MAX) return { ok: false, error: `A quantidade máxima é ${BAG_ITEM_QUANTITY_MAX}.` };
  return { ok: true };
}

export function validateBagItemObservation(observation: string): FieldValidation {
  if (observation.length > BAG_ITEM_OBSERVATION_MAX_LENGTH) {
    return { ok: false, error: `A observação deve ter até ${BAG_ITEM_OBSERVATION_MAX_LENGTH} caracteres.` };
  }
  return { ok: true };
}

/**
 * Valida a seleção de UM grupo (quantos ids foram escolhidos) contra
 * min/max reais do grupo. is_required já implica min_selections >= 1 no
 * banco (Fase 2.3) — não precisa de tratamento especial aqui além do
 * min_selections em si.
 */
export function validateGroupSelection(group: BagAddonGroupForSelection, selectedAddonIds: string[]): FieldValidation {
  const count = selectedAddonIds.length;
  if (count > group.max_selections) {
    return {
      ok: false,
      error: `Escolha no máximo ${group.max_selections} ${group.max_selections === 1 ? "opção" : "opções"} em "${group.name}".`,
    };
  }
  if (count < group.min_selections) {
    return {
      ok: false,
      error: `Escolha pelo menos ${group.min_selections} ${group.min_selections === 1 ? "opção" : "opções"} em "${group.name}".`,
    };
  }
  return { ok: true };
}

/** Valida todos os grupos de uma vez — para o botão de decidir se pode habilitar "Adicionar à sacola". */
export function validateAllGroupsSelection(
  groups: BagAddonGroupForSelection[],
  selections: Record<string, string[]>
): FieldValidation {
  for (const group of groups) {
    const result = validateGroupSelection(group, selections[group.id] ?? []);
    if (!result.ok) return result;
  }
  return { ok: true };
}

export function calculateItemSubtotal(basePrice: number, selectedAddons: { price: number }[], quantity: number): number {
  const addonsTotal = selectedAddons.reduce((sum, addon) => sum + addon.price, 0);
  return (basePrice + addonsTotal) * quantity;
}

/**
 * Chave de identidade do item na sacola — dois itens do MESMO produto com
 * adicionais ou observação diferentes precisam de chaves diferentes (para
 * coexistirem como linhas separadas); a mesma combinação exata gera a
 * mesma chave (para permitir somar quantidade em vez de duplicar linha).
 */
export function buildBagItemKey(productId: string, selectedAddonIds: string[], observation: string): string {
  const sortedAddonIds = [...selectedAddonIds].sort();
  return `${productId}::${sortedAddonIds.join(",")}::${observation.trim()}`;
}

export function createBagItem(params: {
  productId: string;
  name: string;
  basePrice: number;
  imageUrl: string | null;
  quantity: number;
  observation: string;
  selectedAddons: BagSelectedAddon[];
}): BagItem {
  const { productId, name, basePrice, imageUrl, quantity, observation, selectedAddons } = params;
  const trimmedObservation = observation.trim();
  return {
    key: buildBagItemKey(
      productId,
      selectedAddons.map((a) => a.addonId),
      trimmedObservation
    ),
    productId,
    name,
    basePrice,
    imageUrl,
    quantity,
    observation: trimmedObservation,
    selectedAddons,
    subtotal: calculateItemSubtotal(basePrice, selectedAddons, quantity),
  };
}
