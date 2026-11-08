import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingRpc } from "./rpcErrors";

/**
 * Variantes de produto (ex.: Pequena/Média/Grande) — cadastro no painel. Escrita só pelas RPCs product_variant_*.
 * Loja, sacola e PDV: ver storeVariants.ts (create_order cobra o preço da variante — migration 20261108000000).
 */
export const VARIANT_NAME_MAX = 60;
export const VARIANT_MAX_PER_PRODUCT = 20;
export const VARIANT_MAX_PRICE = 99999.99;

export type Variant = { id: string; productId: string; name: string; price: number; isAvailable: boolean; displayOrder: number };
export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateVariantInput(rawName: unknown, rawPrice: number | null): Validation<{ name: string; price: number }> {
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) return { ok: false, error: "Informe o nome da variante." };
  if (name.length > VARIANT_NAME_MAX) return { ok: false, error: `O nome deve ter até ${VARIANT_NAME_MAX} caracteres.` };
  if (rawPrice === null || !Number.isFinite(rawPrice) || rawPrice <= 0) return { ok: false, error: "Informe um preço maior que zero." };
  if (rawPrice > VARIANT_MAX_PRICE) return { ok: false, error: "Preço alto demais." };
  return { ok: true, value: { name, price: Math.round(rawPrice * 100) / 100 } };
}

export const isVariantId = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export function friendlyVariantError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("variant_duplicate") || m.includes("duplicate key")) return "Já existe uma variante com esse nome neste produto.";
  if (m.includes("too_many_variants")) return `Cada produto aceita até ${VARIANT_MAX_PER_PRODUCT} variantes.`;
  if (m.includes("invalid_name")) return "Nome inválido.";
  if (m.includes("invalid_price")) return "Preço inválido.";
  if (m.includes("not_authorized")) return "Você não tem permissão para esta ação.";
  return "Não foi possível concluir agora. Tente novamente.";
}

type Row = Record<string, unknown>;
const parse = (r: Row): Variant => ({
  id: String(r.id), productId: String(r.product_id), name: String(r.name), price: Number(r.price),
  isAvailable: Boolean(r.is_available), displayOrder: Number(r.display_order ?? 0),
});

export type VariantsResult = { available: boolean; variants: Variant[] };

/** Variantes da loja. Sem a migration devolve available=false (a tela mostra "indisponível"). */
export async function getVariants(supabase: SupabaseClient, restaurantId: string): Promise<VariantsResult> {
  const { data, error } = await supabase
    .from("product_variants")
    .select("id, product_id, name, price, is_available, display_order")
    .eq("restaurant_id", restaurantId)
    .order("display_order", { ascending: true })
    .limit(2000);
  if (isMissingRpc(error)) return { available: false, variants: [] };
  if (error) throw error;
  return { available: true, variants: ((data as Row[] | null) ?? []).map(parse) };
}

export function groupByProduct(variants: Variant[]): Map<string, Variant[]> {
  const map = new Map<string, Variant[]>();
  for (const v of variants) map.set(v.productId, [...(map.get(v.productId) ?? []), v]);
  return map;
}
