import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingRpc } from "./rpcErrors";

/**
 * Variantes na LOJA e no PDV (ex.: pizza Pequena/Média/Grande). Módulo puro + leitura tolerante.
 *
 * Regras (as mesmas que create_order aplica no banco — migration 20261108000000_order_item_variants.sql):
 *   * produto com variantes exige escolher UMA; o preço do item é o da variante;
 *   * variante desligada não pode ser escolhida;
 *   * produto sem variantes segue exatamente como antes (preço do produto, payload sem variant_id).
 * O preço calculado aqui é só visual: create_order recalcula tudo a partir do banco.
 *
 * Banco sem as migrations de variantes: a leitura devolve lista vazia (a loja funciona como antes).
 * As duas migrations (20261105040000 e 20261108000000) precisam ser aplicadas JUNTAS: com só a primeira,
 * membros logados veriam variantes que o create_order antigo ignoraria.
 */
export type PublicVariant = { id: string; productId: string; name: string; price: number; isAvailable: boolean };

type Row = Record<string, unknown>;
const parse = (r: Row): PublicVariant => ({
  id: String(r.id),
  productId: String(r.product_id),
  name: String(r.name),
  price: Number(r.price),
  isAvailable: r.is_available === true,
});

/** Tabela ausente (migration não aplicada) ou sem permissão de leitura (visitante antes da migration): sem variantes. */
function isVariantsUnavailable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return isMissingRpc(error) || error.code === "42501" || /permission denied/i.test(error.message ?? "");
}

const SELECT = "id, product_id, name, price, is_available, display_order";

/** Variantes de UM produto, sempre amarradas à loja do slug (nunca só por id). */
export async function getProductVariantsForStore(
  supabase: SupabaseClient,
  restaurantId: string,
  productId: string
): Promise<PublicVariant[]> {
  const { data, error } = await supabase
    .from("product_variants")
    .select(SELECT)
    .eq("restaurant_id", restaurantId)
    .eq("product_id", productId)
    .order("display_order", { ascending: true })
    .limit(50);
  if (isVariantsUnavailable(error)) return [];
  if (error) throw error;
  return ((data as Row[] | null) ?? []).map(parse);
}

/** Todas as variantes da loja (para o "a partir de" do cardápio). */
export async function getStoreVariants(supabase: SupabaseClient, restaurantId: string): Promise<PublicVariant[]> {
  const { data, error } = await supabase
    .from("product_variants")
    .select(SELECT)
    .eq("restaurant_id", restaurantId)
    .order("display_order", { ascending: true })
    .limit(5000);
  if (isVariantsUnavailable(error)) return [];
  if (error) throw error;
  return ((data as Row[] | null) ?? []).map(parse);
}

/** Menor preço entre as variantes disponíveis; null quando não há nenhuma disponível. */
export function variantFromPrice(variants: PublicVariant[]): number | null {
  const prices = variants.filter((v) => v.isAvailable).map((v) => v.price);
  return prices.length > 0 ? Math.min(...prices) : null;
}

/** Produto com variantes, todas desligadas: não dá para pedir (create_order recusaria). */
export function allVariantsUnavailable(variants: PublicVariant[]): boolean {
  return variants.length > 0 && variants.every((v) => !v.isAvailable);
}

export type VariantChoice =
  | { ok: true; variant: PublicVariant | null }
  | { ok: false; error: string };

/** Valida a escolha: sem variantes → null (pedido de sempre); com variantes → exige uma disponível. */
export function resolveVariantChoice(variants: PublicVariant[], selectedId: string | null): VariantChoice {
  if (variants.length === 0) return { ok: true, variant: null };
  if (!selectedId) return { ok: false, error: "Escolha uma opção (tamanho/versão)." };
  const variant = variants.find((v) => v.id === selectedId);
  if (!variant) return { ok: false, error: "Opção inválida. Escolha novamente." };
  if (!variant.isAvailable) return { ok: false, error: `A opção "${variant.name}" está indisponível no momento.` };
  return { ok: true, variant };
}

/** Pré-seleção: a única variante disponível, quando só há uma; senão nenhuma (o cliente escolhe). */
export function defaultVariantId(variants: PublicVariant[]): string | null {
  const available = variants.filter((v) => v.isAvailable);
  return available.length === 1 ? available[0].id : null;
}

/** Mesmo nome que create_order grava no item: "Produto — Variante". */
export function variantItemName(productName: string, variantName: string | null | undefined): string {
  return variantName ? `${productName} — ${variantName}` : productName;
}
