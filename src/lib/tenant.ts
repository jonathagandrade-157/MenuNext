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
