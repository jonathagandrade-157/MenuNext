/**
 * Camada de leitura pública da loja (/loja/[slug]) — pura o suficiente para
 * ser testada sem banco (cálculo de aberto/fechado) e fetchers finos que só
 * chamam a RPC/policies públicas criadas na migration
 * add_public_storefront_read_access + fix_public_read_restaurant_visibility_check.
 * Nunca aceita restaurant_id do cliente: tudo é resolvido a partir do slug,
 * através de `get_public_restaurant_by_slug` (RPC SECURITY DEFINER que já
 * filtra por onboarding_completed = true).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessHour, Combo, ComboItem, Product, ProductImage, RestaurantStatus } from "@/lib/tenant";

export type PublicRestaurant = {
  id: string;
  name: string;
  slug: string;
  status: RestaurantStatus;
  onboarding_completed: boolean;
  logo_path: string | null;
  cover_path: string | null;
  service_delivery: boolean;
  service_pickup: boolean;
  delivery_fee: number | null;
  delivery_radius_km: number | null;
};

/** Busca o restaurante pelo slug via RPC pública — null se não existir ou não estiver publicado. */
export async function getPublicRestaurantBySlug(
  supabase: SupabaseClient,
  slug: string
): Promise<PublicRestaurant | null> {
  const { data, error } = await supabase.rpc("get_public_restaurant_by_slug", { p_slug: slug });
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return {
    ...row,
    delivery_fee: row.delivery_fee === null ? null : Number(row.delivery_fee),
    delivery_radius_km: row.delivery_radius_km === null ? null : Number(row.delivery_radius_km),
  } as PublicRestaurant;
}

export type PublicProduct = Product & { imageUrl: string | null };
export type PublicCategoryWithProducts = {
  id: string;
  name: string;
  description: string | null;
  display_order: number;
  products: PublicProduct[];
};

/**
 * Categorias ativas do restaurante com seus produtos (a policy pública de
 * categories já filtra is_active = true; a de products não filtra por
 * disponibilidade — o produto indisponível continua vindo, para a UI
 * marcar visualmente em vez de escondê-lo). A capa de cada produto é a
 * imagem de menor display_order.
 */
export async function getPublicCategoriesWithProducts(
  supabase: SupabaseClient,
  restaurantId: string,
  getImageUrl: (path: string) => string
): Promise<PublicCategoryWithProducts[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, description, display_order, products(*, product_images(*))")
    .eq("restaurant_id", restaurantId)
    .order("display_order");
  if (error) throw error;

  return (data ?? []).map((category) => {
    const products = ((category.products ?? []) as (Product & { product_images: ProductImage[] })[])
      .slice()
      .sort((a, b) => a.display_order - b.display_order)
      .map((product) => {
        const images = [...(product.product_images ?? [])].sort((a, b) => a.display_order - b.display_order);
        const cover = images[0];
        return {
          ...product,
          price: Number(product.price),
          cost: product.cost === null ? null : Number(product.cost),
          imageUrl: cover ? getImageUrl(cover.storage_path) : null,
        } as PublicProduct;
      });
    return {
      id: category.id,
      name: category.name,
      description: category.description,
      display_order: category.display_order,
      products,
    };
  });
}

export type PublicComboItem = ComboItem & { product: Product };
export type PublicCombo = Combo & { imageUrl: string | null; combo_items: PublicComboItem[] };

export async function getPublicCombosWithItems(
  supabase: SupabaseClient,
  restaurantId: string,
  getImageUrl: (path: string) => string
): Promise<PublicCombo[]> {
  const { data, error } = await supabase
    .from("combos")
    .select("*, combo_items(*, product:products(*))")
    .eq("restaurant_id", restaurantId)
    .order("display_order");
  if (error) throw error;

  return (data ?? []).map((combo) => ({
    ...combo,
    price: Number(combo.price),
    imageUrl: combo.image_path ? getImageUrl(combo.image_path) : null,
    combo_items: ((combo.combo_items ?? []) as (ComboItem & { product: Product & { price: string; cost: string | null } })[])
      .map((item) => ({
        ...item,
        product: { ...item.product, price: Number(item.product.price), cost: item.product.cost === null ? null : Number(item.product.cost) },
      }))
      .sort((a, b) => a.display_order - b.display_order),
  })) as PublicCombo[];
}

export async function getPublicBusinessHours(supabase: SupabaseClient, restaurantId: string): Promise<BusinessHour[]> {
  const { data, error } = await supabase
    .from("business_hours")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("day_of_week");
  if (error) throw error;
  return (data ?? []) as BusinessHour[];
}

// ---------------------------------------------------------------------------
// Estado aberto/fechado — puro, testável sem banco (recebe `now` injetado).
// ---------------------------------------------------------------------------

export type StoreOpenState =
  | { status: "open" }
  | { status: "closed_hours" }
  | { status: "paused" }
  | { status: "closed_permanently" };

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Combina restaurants.status (mecanismo real já existente) com
 * business_hours do dia atual — nunca um "Aberto" fixo no código. `status`
 * "paused"/"closed" sempre vencem (a loja não deve parecer aberta só porque
 * bateu o horário); só quando "active" é que o horário do dia decide.
 * Suporta horário que passa da meia-noite (ex.: 18:00–02:00).
 */
export function computeStoreOpenState(
  status: RestaurantStatus,
  businessHours: BusinessHour[],
  now: Date = new Date()
): StoreOpenState {
  if (status === "paused") return { status: "paused" };
  if (status === "closed" || status === "draft") return { status: "closed_permanently" };

  const today = businessHours.find((h) => h.day_of_week === now.getDay());
  if (!today || !today.is_open || !today.opens_at || !today.closes_at) {
    return { status: "closed_hours" };
  }

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const opens = timeToMinutes(today.opens_at);
  const closes = timeToMinutes(today.closes_at);

  const isWithinRange = closes > opens ? nowMinutes >= opens && nowMinutes < closes : nowMinutes >= opens || nowMinutes < closes;

  return isWithinRange ? { status: "open" } : { status: "closed_hours" };
}

export function formatCurrencyBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
