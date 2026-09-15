"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMyRestaurant, type Restaurant } from "@/lib/tenant";
import { uploadRestaurantCover, uploadRestaurantLogo } from "@/lib/storage/assets";
import type { AparenciaActionState } from "@/lib/form-state";

const APARENCIA_PATH = "/painel/aparencia";

async function requireRestaurant(): Promise<{ supabase: SupabaseClient; restaurant: Restaurant }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  return { supabase, restaurant };
}

/**
 * Logo e capa do restaurante — reaproveita integralmente
 * uploadRestaurantLogo/uploadRestaurantCover (src/lib/storage/assets.ts,
 * já existentes desde a Fase 1.5: mesmo bucket restaurant-assets, mesma
 * validação de magic bytes). Nenhuma infraestrutura nova.
 */
export async function uploadLogoAction(_prev: AparenciaActionState, formData: FormData): Promise<AparenciaActionState> {
  const { supabase, restaurant } = await requireRestaurant();

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Selecione uma imagem." };

  const result = await uploadRestaurantLogo(supabase, restaurant.id, file);
  if (!result.ok) return { status: "error", message: result.error };

  revalidatePath(APARENCIA_PATH);
  revalidatePath("/painel");
  return { status: "success" };
}

export async function uploadCoverAction(_prev: AparenciaActionState, formData: FormData): Promise<AparenciaActionState> {
  const { supabase, restaurant } = await requireRestaurant();

  const file = formData.get("cover");
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Selecione uma imagem." };

  const result = await uploadRestaurantCover(supabase, restaurant.id, file);
  if (!result.ok) return { status: "error", message: result.error };

  revalidatePath(APARENCIA_PATH);
  revalidatePath("/painel");
  return { status: "success" };
}
