"use server";

import { revalidatePath } from "next/cache";
import { requireOwnerAction } from "@/lib/tenant";
import { uploadRestaurantCover, uploadRestaurantLogo } from "@/lib/storage/assets";
import type { AparenciaActionState, BannerActionState, ThemeColorActionState } from "@/lib/form-state";
import { validateBanner } from "@/lib/banner";

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const APARENCIA_PATH = "/painel/aparencia";

/**
 * Logo e capa do restaurante — reaproveita integralmente
 * uploadRestaurantLogo/uploadRestaurantCover (src/lib/storage/assets.ts,
 * já existentes desde a Fase 1.5: mesmo bucket restaurant-assets, mesma
 * validação de magic bytes). Nenhuma infraestrutura nova.
 */
export async function uploadLogoAction(_prev: AparenciaActionState, formData: FormData): Promise<AparenciaActionState> {
  const { supabase, restaurant } = await requireOwnerAction();

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Selecione uma imagem." };

  const result = await uploadRestaurantLogo(supabase, restaurant.id, file);
  if (!result.ok) return { status: "error", message: result.error };

  revalidatePath(APARENCIA_PATH);
  revalidatePath("/painel");
  return { status: "success" };
}

export async function uploadCoverAction(_prev: AparenciaActionState, formData: FormData): Promise<AparenciaActionState> {
  const { supabase, restaurant } = await requireOwnerAction();

  const file = formData.get("cover");
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Selecione uma imagem." };

  const result = await uploadRestaurantCover(supabase, restaurant.id, file);
  if (!result.ok) return { status: "error", message: result.error };

  revalidatePath(APARENCIA_PATH);
  revalidatePath("/painel");
  return { status: "success" };
}

/**
 * Cor primária da loja pública (área "Aparência" do redesign) — única peça
 * implementada do motor de tema do mockup (paleta por IA, WCAG automático,
 * produtos em destaque, banner promocional e preview ao vivo ficaram fora
 * desta entrega, ver commit). Aplicada só em /loja/[slug] via CSS var
 * inline — nunca no painel nem no globals.css, que são compartilhados por
 * todos os restaurantes.
 */
export async function saveThemeColorAction(_prev: ThemeColorActionState, formData: FormData): Promise<ThemeColorActionState> {
  const { supabase, restaurant } = await requireOwnerAction();

  const raw = String(formData.get("theme_primary_color") ?? "").trim();
  const color = raw === "" ? null : raw;

  if (color !== null && !HEX_COLOR_PATTERN.test(color)) {
    return { status: "error", message: "Informe uma cor válida (ex.: #AB2F00)." };
  }

  const { error } = await supabase.from("restaurants").update({ theme_primary_color: color }).eq("id", restaurant.id);
  if (error) return { status: "error", message: "Não foi possível salvar. Tente novamente." };

  revalidatePath(APARENCIA_PATH);
  return { status: "success" };
}

/**
 * Banner promocional da loja pública (restaurant_banners): texto curto e liga/desliga.
 * Só o OWNER (política de RLS própria). Upsert: a linha da loja nasce na primeira gravação.
 */
export async function saveBannerAction(_prev: BannerActionState, formData: FormData): Promise<BannerActionState> {
  const { supabase, restaurant } = await requireOwnerAction();

  const enabled = formData.get("banner_enabled") === "on";
  const validation = validateBanner(String(formData.get("banner_message") ?? ""), enabled);
  if (!validation.ok) return { status: "error", message: validation.error };

  const { error } = await supabase
    .from("restaurant_banners")
    .upsert({ restaurant_id: restaurant.id, is_enabled: enabled, message: validation.message }, { onConflict: "restaurant_id" });
  if (error) return { status: "error", message: "Não foi possível salvar o banner. Tente novamente." };

  revalidatePath(APARENCIA_PATH);
  return { status: "success" };
}
