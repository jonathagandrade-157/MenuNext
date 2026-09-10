import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type RestaurantStatus = "draft" | "active" | "paused" | "closed";

export type Restaurant = {
  id: string;
  name: string;
  slug: string;
  status: RestaurantStatus;
  onboarding_completed: boolean;
  onboarding_step: number;
  address_zip: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_state: string | null;
  service_delivery: boolean;
  service_pickup: boolean;
  delivery_fee: number | null;
  delivery_radius_km: number | null;
  payment_pix: boolean;
  payment_pix_key: string | null;
  payment_cash: boolean;
  payment_card: boolean;
  created_at: string;
  updated_at: string;
};

export type OnboardingProgress = {
  restaurant_id: string;
  current_step: number;
  completed_steps: number[];
  updated_at: string;
};

/** Rota de cada passo do onboarding, na sequência oficial (SCREEN_45..37). */
export const ONBOARDING_STEP_PATHS: Record<number, string> = {
  1: "/onboarding/passo-1",
  2: "/onboarding/passo-2",
  3: "/onboarding/passo-3",
  4: "/onboarding/passo-4",
  5: "/onboarding/passo-5",
  6: "/onboarding/passo-6",
  7: "/onboarding/passo-7",
};

export async function getAuthedUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/** Restaurante do usuário autenticado atual, ou null se ainda não criou nenhum. */
export async function getMyRestaurant(supabase: SupabaseClient): Promise<Restaurant | null> {
  const { data, error } = await supabase.from("restaurants").select("*").maybeSingle();
  if (error) throw error;
  return data as Restaurant | null;
}

export async function getOnboardingProgress(
  supabase: SupabaseClient,
  restaurantId: string
): Promise<OnboardingProgress | null> {
  const { data, error } = await supabase
    .from("onboarding_progress")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (error) throw error;
  return data as OnboardingProgress | null;
}

export async function getMyMembership(supabase: SupabaseClient, restaurantId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("restaurant_members")
    .select("role")
    .eq("restaurant_id", restaurantId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  return data as { role: "OWNER" | "STAFF" } | null;
}

export type BusinessHour = {
  restaurant_id: string;
  day_of_week: number;
  is_open: boolean;
  opens_at: string | null;
  closes_at: string | null;
};

export async function getBusinessHours(supabase: SupabaseClient, restaurantId: string): Promise<BusinessHour[]> {
  const { data, error } = await supabase
    .from("business_hours")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("day_of_week");
  if (error) throw error;
  return (data ?? []) as BusinessHour[];
}

export type Category = {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export async function getCategories(supabase: SupabaseClient, restaurantId: string): Promise<Category[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("display_order");
  if (error) throw error;
  return (data ?? []) as Category[];
}

/** Quantos produtos (reais, não mockados) cada categoria do restaurante tem. */
export async function getCategoryProductCounts(
  supabase: SupabaseClient,
  restaurantId: string
): Promise<Record<string, number>> {
  const { data, error } = await supabase.from("products").select("category_id").eq("restaurant_id", restaurantId);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    counts[row.category_id] = (counts[row.category_id] ?? 0) + 1;
  }
  return counts;
}

export type ProductImage = {
  id: string;
  restaurant_id: string;
  product_id: string;
  storage_path: string;
  display_order: number;
  created_at: string;
};

export type Product = {
  id: string;
  restaurant_id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: number;
  cost: number | null;
  is_available: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
};

export type ProductWithImages = Product & { product_images: ProductImage[] };

/** Lista enxuta de produtos do restaurante, sem imagens — usada onde só o
 * cadastro básico do produto importa (ex.: seletor de produtos ao montar a
 * composição de um combo). */
export async function getProducts(supabase: SupabaseClient, restaurantId: string): Promise<Product[]> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("display_order");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...row,
    price: Number(row.price),
    cost: row.cost === null ? null : Number(row.cost),
  })) as Product[];
}

/**
 * Produtos do restaurante com suas imagens já embutidas (join via a FK
 * product_images.product_id -> products.id). `price`/`cost` chegam do
 * PostgREST como string (numeric é serializado assim para não perder
 * precisão) — convertidos aqui para number, já que exibimos/formatamos
 * esses valores na UI.
 */
export async function getProductsWithImages(
  supabase: SupabaseClient,
  restaurantId: string
): Promise<ProductWithImages[]> {
  const { data, error } = await supabase
    .from("products")
    .select("*, product_images(*)")
    .eq("restaurant_id", restaurantId)
    .order("display_order");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...row,
    price: Number(row.price),
    cost: row.cost === null ? null : Number(row.cost),
    product_images: (row.product_images ?? []) as ProductImage[],
  })) as ProductWithImages[];
}

export type AddonGroup = {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  min_selections: number;
  max_selections: number;
  is_required: boolean;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
};

export type Addon = {
  id: string;
  restaurant_id: string;
  addon_group_id: string;
  name: string;
  description: string | null;
  price: number;
  is_available: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
};

export type AddonGroupWithAddons = AddonGroup & { addons: Addon[] };

export type ProductAddonGroup = {
  id: string;
  restaurant_id: string;
  product_id: string;
  addon_group_id: string;
  display_order: number;
  created_at: string;
};

export type ProductAddonGroupWithGroup = ProductAddonGroup & { addon_group: AddonGroup };

/**
 * Grupos de adicionais do restaurante, cada um com seus itens já embutidos
 * (join via addon_group_id). `price` chega do PostgREST como string (numeric
 * é serializado assim para não perder precisão) — convertido aqui para
 * number, mesmo padrão usado em getProductsWithImages.
 */
export async function getAddonGroupsWithAddons(
  supabase: SupabaseClient,
  restaurantId: string
): Promise<AddonGroupWithAddons[]> {
  const { data, error } = await supabase
    .from("addon_groups")
    .select("*, addons(*)")
    .eq("restaurant_id", restaurantId)
    .order("display_order");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...row,
    addons: ((row.addons ?? []) as Addon[])
      .map((addon) => ({ ...addon, price: Number(addon.price) }))
      .sort((a, b) => a.display_order - b.display_order),
  })) as AddonGroupWithAddons[];
}

/**
 * Associações produto <-> grupo de todo o restaurante, com o grupo já
 * embutido (usadas pela seção "Adicionais" no editor de produto — evita uma
 * consulta por produto).
 */
export async function getProductAddonGroupsForRestaurant(
  supabase: SupabaseClient,
  restaurantId: string
): Promise<ProductAddonGroupWithGroup[]> {
  const { data, error } = await supabase
    .from("product_addon_groups")
    .select("*, addon_group:addon_groups(*)")
    .eq("restaurant_id", restaurantId)
    .order("display_order");
  if (error) throw error;
  return (data ?? []) as ProductAddonGroupWithGroup[];
}

export type Combo = {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  price: number;
  image_path: string | null;
  is_available: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
};

export type ComboItem = {
  id: string;
  restaurant_id: string;
  combo_id: string;
  product_id: string;
  quantity: number;
  display_order: number;
  created_at: string;
};

export type ComboItemWithProduct = ComboItem & { product: Product };

export type ComboWithItems = Combo & { combo_items: ComboItemWithProduct[] };

/**
 * Combos do restaurante com sua composição já embutida (join via combo_id e,
 * dentro de cada item, o produto referenciado). `price`/`product.price`/
 * `product.cost` chegam do PostgREST como string (numeric) — convertidos
 * aqui para number, mesmo padrão de getProductsWithImages/getAddonGroupsWithAddons.
 * Um produto usado no combo que tenha ficado indisponível (product.is_available
 * = false) continua vindo normalmente aqui — a UI decide como sinalizar isso,
 * o combo nunca é excluído/alterado por causa disso.
 */
export async function getCombosWithItems(supabase: SupabaseClient, restaurantId: string): Promise<ComboWithItems[]> {
  const { data, error } = await supabase
    .from("combos")
    .select("*, combo_items(*, product:products(*))")
    .eq("restaurant_id", restaurantId)
    .order("display_order");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...row,
    price: Number(row.price),
    combo_items: ((row.combo_items ?? []) as (ComboItem & { product: Product & { price: string; cost: string | null } })[])
      .map((item) => ({
        ...item,
        product: { ...item.product, price: Number(item.product.price), cost: item.product.cost === null ? null : Number(item.product.cost) },
      }))
      .sort((a, b) => a.display_order - b.display_order),
  })) as ComboWithItems[];
}

/**
 * Guarda de acesso autoritativa para um passo do onboarding (chamada no
 * início de cada página `/onboarding/passo-N`). Redireciona para:
 * - /cadastro, se não autenticado;
 * - /onboarding/passo-1, se o restaurante ainda não existe (e o passo pedido não é o 1);
 * - /onboarding/loja-pronta, se o onboarding já foi concluído;
 * - o passo salvo em onboarding_progress, se `step` pedir para pular à frente.
 */
export async function requireOnboardingStep(step: number) {
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) {
    if (step !== 1) redirect("/onboarding/passo-1");
    return { supabase, restaurant: null as Restaurant | null, progress: null as OnboardingProgress | null };
  }

  if (restaurant.onboarding_completed) redirect("/onboarding/loja-pronta");

  const progress = await getOnboardingProgress(supabase, restaurant.id);
  const currentStep = progress?.current_step ?? 1;

  if (step > currentStep) redirect(ONBOARDING_STEP_PATHS[currentStep]);

  return { supabase, restaurant, progress };
}

/**
 * Para onde mandar um usuário já autenticado: sem restaurante -> Passo 1;
 * onboarding incompleto -> o passo salvo; concluído -> /painel. Usada por
 * /cadastro para não reenviar quem já tem sessão ao formulário.
 */
export async function resolvePostAuthPath(supabase: SupabaseClient): Promise<string> {
  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) return "/onboarding/passo-1";
  if (!restaurant.onboarding_completed) {
    const progress = await getOnboardingProgress(supabase, restaurant.id);
    return ONBOARDING_STEP_PATHS[progress?.current_step ?? 1];
  }
  return "/painel";
}

/** Guarda de acesso para /onboarding/loja-pronta. */
export async function requireOnboardingCompleted() {
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  if (!restaurant.onboarding_completed) {
    const progress = await getOnboardingProgress(supabase, restaurant.id);
    redirect(ONBOARDING_STEP_PATHS[progress?.current_step ?? 1]);
  }

  return { supabase, restaurant };
}
