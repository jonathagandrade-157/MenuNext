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
import type {
  Addon,
  AddonGroup,
  AddonGroupWithAddons,
  BusinessHour,
  Combo,
  ComboItem,
  Product,
  ProductAddonGroup,
  ProductImage,
  RestaurantStatus,
} from "@/lib/tenant";

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
  delivery_fee_method: "fixed" | "per_km";
  latitude: number | null;
  longitude: number | null;
  minimum_order_value: number | null;
  estimated_delivery_min_minutes: number | null;
  estimated_delivery_max_minutes: number | null;
  payment_pix: boolean;
  payment_cash: boolean;
  payment_card: boolean;
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
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    minimum_order_value: row.minimum_order_value === null ? null : Number(row.minimum_order_value),
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

export type PublicProductImage = { url: string; display_order: number };
export type PublicProductAddonGroup = AddonGroupWithAddons;

export type PublicProductDetail = Product & {
  images: PublicProductImage[];
  addonGroups: PublicProductAddonGroup[];
};

/**
 * Detalhe público de UM produto — sempre valida estruturalmente que o
 * produto pertence ao restaurante do slug (`.eq("id", ...).eq("restaurant_id",
 * ...)` na mesma query, nunca só por id). Retorna null se o produto não
 * existir OU pertencer a outro restaurante — nos dois casos a resposta é a
 * mesma, sem vazar qual.
 *
 * Os grupos de adicionais vêm só da associação deste produto
 * (product_addon_groups), na ordem em que o lojista organizou no painel —
 * nunca "todos os adicionais do restaurante" filtrados no frontend. As
 * policies públicas (Fase 3.2) já garantem grupo ativo + adicional
 * disponível na origem.
 */
export async function getPublicProductDetail(
  supabase: SupabaseClient,
  restaurantId: string,
  productId: string,
  getImageUrl: (path: string) => string
): Promise<PublicProductDetail | null> {
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("*, product_images(*)")
    .eq("id", productId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (productError) throw productError;
  if (!product) return null;

  const images = ((product.product_images ?? []) as ProductImage[])
    .slice()
    .sort((a, b) => a.display_order - b.display_order)
    .map((image) => ({ url: getImageUrl(image.storage_path), display_order: image.display_order }));

  const { data: associations, error: associationsError } = await supabase
    .from("product_addon_groups")
    .select("*, addon_group:addon_groups(*, addons(*))")
    .eq("product_id", productId)
    .eq("restaurant_id", restaurantId)
    .order("display_order");
  if (associationsError) throw associationsError;

  const addonGroups: PublicProductAddonGroup[] = (
    (associations ?? []) as (ProductAddonGroup & { addon_group: AddonGroup & { addons: Addon[] } })[]
  )
    .filter((association) => association.addon_group !== null)
    .map((association) => ({
      ...association.addon_group,
      addons: [...association.addon_group.addons]
        .map((addon) => ({ ...addon, price: Number(addon.price) }))
        .sort((a, b) => a.display_order - b.display_order),
    }));

  return {
    ...product,
    price: Number(product.price),
    cost: product.cost === null ? null : Number(product.cost),
    images,
    addonGroups,
  } as PublicProductDetail;
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

export type PublicOrderItemAddon = { addon_name: string; unit_price: number; subtotal: number };
export type PublicOrderItem = {
  product_name: string;
  unit_price: number;
  quantity: number;
  observation: string | null;
  subtotal: number;
  addons: PublicOrderItemAddon[];
};

export type PublicOrder = {
  public_id: string;
  order_number: number;
  status: string;
  fulfillment_type: "delivery" | "pickup";
  payment_method: "pix" | "cash" | "card";
  change_for: number | null;
  customer_name: string;
  customer_phone: string;
  delivery_zip: string | null;
  delivery_street: string | null;
  delivery_number: string | null;
  delivery_complement: string | null;
  delivery_neighborhood: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  delivery_reference: string | null;
  observation: string | null;
  subtotal: number;
  delivery_fee: number;
  total: number;
  created_at: string;
  restaurant_name: string;
  pix_key: string | null;
  items: PublicOrderItem[];
};

/**
 * Pedido público (tela de confirmação/rastreamento) — sempre via RPC
 * SECURITY DEFINER amarrada a slug + public_id ao mesmo tempo (nunca uma
 * policy de SELECT irrestrita em `orders` para o cliente anônimo). Retorna
 * null se o pedido não existir OU pertencer a outro restaurante — a chave
 * Pix só vem preenchida quando o pagamento do próprio pedido é Pix.
 */
export async function getPublicOrder(supabase: SupabaseClient, slug: string, publicId: string): Promise<PublicOrder | null> {
  const { data, error } = await supabase.rpc("get_public_order", { p_slug: slug, p_public_id: publicId });
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return {
    ...row,
    change_for: row.change_for === null ? null : Number(row.change_for),
    subtotal: Number(row.subtotal),
    delivery_fee: Number(row.delivery_fee),
    total: Number(row.total),
    items: (row.items ?? []) as PublicOrderItem[],
  } as PublicOrder;
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
