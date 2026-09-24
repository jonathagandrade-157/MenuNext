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
  delivery_fee_method: "fixed" | "per_km";
  latitude: number | null;
  longitude: number | null;
  minimum_order_value: number | null;
  estimated_delivery_min_minutes: number | null;
  estimated_delivery_max_minutes: number | null;
  payment_pix: boolean;
  payment_pix_key: string | null;
  payment_cash: boolean;
  payment_card: boolean;
  logo_path: string | null;
  cover_path: string | null;
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

/** MASTER é papel de plataforma (JON-9), não de restaurante — via RPC
 * SECURITY DEFINER (is_platform_admin), já que profiles.is_master não pode
 * ser lido/gravado pelo cliente (revoke explícito na migration). */
export async function isPlatformAdmin(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error) throw error;
  return data === true;
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

/**
 * Guarda de acesso para páginas do painel restritas ao OWNER (JON-10) —
 * telas administrativas (config. da loja, pagamentos, aparência, clientes,
 * equipe) que um STAFF convidado (JON-27) não deve ver nem editar. STAFF
 * autenticado com restaurante válido é redirecionado para /painel em vez de
 * ver um erro — mesmo padrão de redirect silencioso já usado no resto do
 * app (ex.: onboarding incompleto).
 */
export async function requireOwnerPage(): Promise<{ supabase: SupabaseClient; restaurant: Restaurant }> {
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const membership = await getMyMembership(supabase, restaurant.id);
  if (membership?.role !== "OWNER") redirect("/painel");

  return { supabase, restaurant };
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

export type RestaurantMember = {
  id: string;
  user_id: string;
  role: "OWNER" | "STAFF";
  name: string | null;
  phone: string | null;
  email: string;
  created_at: string;
};

/** Equipe do restaurante do usuário logado (nome + e-mail) — via RPC, já
 * que auth.users não é exposto pelo PostgREST para um join direto; deriva o
 * restaurante do próprio chamador (via restaurant_members), nunca recebe
 * um restaurant_id do cliente. */
export async function getRestaurantMembers(supabase: SupabaseClient): Promise<RestaurantMember[]> {
  const { data, error } = await supabase.rpc("get_restaurant_members");
  if (error) throw error;
  return (data ?? []) as RestaurantMember[];
}

export type RestaurantInvite = {
  id: string;
  restaurant_id: string;
  email: string;
  role: "OWNER" | "STAFF";
  token: string;
  status: "pending" | "accepted" | "revoked";
  invited_by: string;
  accepted_by: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
  accepted_at: string | null;
};

/** Convites do restaurante (pendentes, aceitos e revogados), mais recentes
 * primeiro. Lido direto da tabela — RLS já garante que só membros vêem. */
export async function getRestaurantInvites(
  supabase: SupabaseClient,
  restaurantId: string
): Promise<RestaurantInvite[]> {
  const { data, error } = await supabase
    .from("restaurant_invites")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as RestaurantInvite[];
}

/**
 * Guarda de acesso para uma página `/onboarding/passo-N`. Redireciona para
 * /cadastro se não autenticado, e para /onboarding/passo-1 se o restaurante
 * ainda não existe (passo 1 é a única etapa que não pode ser pulada — é ela
 * que cria o restaurante, sem o qual nenhuma outra etapa faz sentido).
 *
 * Reestruturação do onboarding: NENHUM passo mais bloqueia o acesso aos
 * outros. Um restaurante com onboarding_completed = true ou com
 * current_step à frente do passo pedido continua podendo revisitar
 * qualquer passo (por "Voltar" ou por um link "Configurar" vindo do
 * checklist do painel) — os passos viram telas de edição reaproveitáveis a
 * qualquer momento, não só na primeira passagem. Ver Fase de reestruturação
 * do onboarding + checklist de configuração.
 */
export async function requireOnboardingStep(step: number) {
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) {
    if (step !== 1) redirect("/onboarding/passo-1");
    return { supabase, restaurant: null as Restaurant | null, progress: null as OnboardingProgress | null };
  }

  const progress = await getOnboardingProgress(supabase, restaurant.id);
  return { supabase, restaurant, progress };
}

/**
 * Para onde mandar um usuário já autenticado: sem restaurante -> Passo 1
 * (única etapa obrigatória); com restaurante -> painel, mesmo que o
 * onboarding guiado não tenha sido concluído. O painel é onde a
 * configuração é completada (checklist); o onboarding é só um guia inicial
 * opcional. Usada por /cadastro para não reenviar quem já tem sessão ao
 * formulário.
 */
export async function resolvePostAuthPath(supabase: SupabaseClient): Promise<string> {
  const restaurant = await getMyRestaurant(supabase);
  return restaurant ? "/painel" : "/onboarding/passo-1";
}

/** Guarda de acesso para /onboarding/loja-pronta — a tela de celebração só
 * faz sentido logo após concluir/pular a última etapa; sem restaurante ou
 * com onboarding ainda incompleto, manda para o lugar certo em vez de
 * mostrar uma celebração que não aconteceu. */
export async function requireOnboardingCompleted() {
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");
  if (!restaurant.onboarding_completed) redirect("/painel");

  return { supabase, restaurant };
}
