"use server";

import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMyRestaurant, getOnboardingProgress, ONBOARDING_STEP_PATHS, type Restaurant } from "@/lib/tenant";
import type { StepActionState } from "@/lib/form-state";
import { WEEK_DAYS } from "@/lib/form-state";

export type { StepActionState };

const COMBINING_DIACRITICS_RANGE_START = 0x0300;
const COMBINING_DIACRITICS_RANGE_END = 0x036f;

function normalizeSlug(input: string): string {
  const withoutDiacritics = Array.from(input.normalize("NFD"))
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < COMBINING_DIACRITICS_RANGE_START || code > COMBINING_DIACRITICS_RANGE_END;
    })
    .join("");

  return withoutDiacritics
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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

/** Marca o passo como concluído e avança (ou finaliza, no passo 7). */
async function advanceStep(supabase: SupabaseClient, restaurant: Restaurant, completedStep: number) {
  const isLastStep = completedStep >= 7;
  const nextStep = Math.min(completedStep + 1, 7);

  const progress = await getOnboardingProgress(supabase, restaurant.id);
  const completedSteps = Array.from(new Set([...(progress?.completed_steps ?? []), completedStep])).sort(
    (a, b) => a - b
  );

  await supabase
    .from("onboarding_progress")
    .update({ current_step: nextStep, completed_steps: completedSteps })
    .eq("restaurant_id", restaurant.id);

  const restaurantUpdate: Record<string, unknown> = { onboarding_step: nextStep };
  if (isLastStep) {
    restaurantUpdate.onboarding_completed = true;
    restaurantUpdate.status = "active";
  }
  await supabase.from("restaurants").update(restaurantUpdate).eq("id", restaurant.id);

  redirect(isLastStep ? "/onboarding/loja-pronta" : ONBOARDING_STEP_PATHS[nextStep]);
}

// ---------------------------------------------------------------------------
// Passo 1 — nome do restaurante e slug (cria o restaurante via RPC)
// ---------------------------------------------------------------------------

export async function checkSlugAvailability(rawSlug: string): Promise<{ slug: string; available: boolean }> {
  const slug = normalizeSlug(rawSlug);
  if (slug.length < 3) return { slug, available: false };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_slug_available", { p_slug: slug });
  if (error) return { slug, available: false };
  return { slug, available: Boolean(data) };
}

export async function savePasso1Action(_prev: StepActionState, formData: FormData): Promise<StepActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/cadastro");

  const name = String(formData.get("name") ?? "").trim();
  const slug = normalizeSlug(String(formData.get("slug") ?? ""));

  if (!name) return { status: "error", message: "Informe o nome do restaurante." };
  if (slug.length < 3) {
    return { status: "error", message: "Escolha uma URL com pelo menos 3 caracteres (letras, números e hífen)." };
  }

  const { data: restaurant, error } = await supabase.rpc("create_restaurant", { p_name: name, p_slug: slug });

  if (error) {
    if (error.code === "23505" || error.message.includes("slug_taken")) {
      return { status: "error", message: "Essa URL já está em uso. Escolha outra." };
    }
    if (error.message.includes("invalid_slug")) {
      return { status: "error", message: "URL inválida. Use apenas letras minúsculas, números e hífen." };
    }
    return { status: "error", message: "Não foi possível salvar. Tente novamente." };
  }

  // A RPC cria onboarding_progress com current_step = 1. Sem passar por
  // advanceStep aqui, o passo nunca avança: o guard de /onboarding/passo-2
  // (requireOnboardingStep) vê current_step ainda em 1 e manda de volta
  // para o passo-1 — é exatamente o bug de "não navega para a Etapa 2".
  await advanceStep(supabase, restaurant as Restaurant, 1);
  return { status: "idle" };
}

// ---------------------------------------------------------------------------
// Passo 2 — endereço
// ---------------------------------------------------------------------------

export async function savePasso2Action(_prev: StepActionState, formData: FormData): Promise<StepActionState> {
  const { supabase, restaurant } = await requireRestaurant();

  const address = {
    address_zip: String(formData.get("zip") ?? "").trim(),
    address_street: String(formData.get("street") ?? "").trim(),
    address_number: String(formData.get("number") ?? "").trim(),
    address_complement: String(formData.get("complement") ?? "").trim() || null,
    address_neighborhood: String(formData.get("neighborhood") ?? "").trim(),
    address_city: String(formData.get("city") ?? "").trim(),
    address_state: String(formData.get("state") ?? "").trim(),
  };

  if (!address.address_zip || !address.address_street || !address.address_city || !address.address_state) {
    return { status: "error", message: "Preencha CEP, endereço, cidade e estado." };
  }

  const { error } = await supabase.from("restaurants").update(address).eq("id", restaurant.id);
  if (error) return { status: "error", message: "Não foi possível salvar o endereço. Tente novamente." };

  await advanceStep(supabase, restaurant, 2);
  return { status: "idle" };
}

// ---------------------------------------------------------------------------
// Passo 3 — formas de atendimento
// ---------------------------------------------------------------------------

export async function savePasso3Action(_prev: StepActionState, formData: FormData): Promise<StepActionState> {
  const { supabase, restaurant } = await requireRestaurant();

  const serviceDelivery = formData.get("service_delivery") === "on";
  const servicePickup = formData.get("service_pickup") === "on";

  if (!serviceDelivery && !servicePickup) {
    return { status: "error", message: "Selecione ao menos uma forma de atendimento." };
  }

  const { error } = await supabase
    .from("restaurants")
    .update({ service_delivery: serviceDelivery, service_pickup: servicePickup })
    .eq("id", restaurant.id);
  if (error) return { status: "error", message: "Não foi possível salvar. Tente novamente." };

  await advanceStep(supabase, restaurant, 3);
  return { status: "idle" };
}

// ---------------------------------------------------------------------------
// Passo 4 — configuração de delivery
// ---------------------------------------------------------------------------

export async function savePasso4Action(_prev: StepActionState, formData: FormData): Promise<StepActionState> {
  const { supabase, restaurant } = await requireRestaurant();

  const feeRaw = String(formData.get("delivery_fee") ?? "").replace(",", ".");
  const radiusRaw = String(formData.get("delivery_radius_km") ?? "").replace(",", ".");

  if (restaurant.service_delivery) {
    if (!feeRaw || Number.isNaN(Number(feeRaw)) || Number(feeRaw) < 0) {
      return { status: "error", message: "Informe uma taxa de entrega válida." };
    }
    if (!radiusRaw || Number.isNaN(Number(radiusRaw)) || Number(radiusRaw) <= 0) {
      return { status: "error", message: "Informe um raio de entrega válido." };
    }
  }

  const { error } = await supabase
    .from("restaurants")
    .update({
      delivery_fee: restaurant.service_delivery ? Number(feeRaw) : null,
      delivery_radius_km: restaurant.service_delivery ? Number(radiusRaw) : null,
    })
    .eq("id", restaurant.id);
  if (error) return { status: "error", message: "Não foi possível salvar. Tente novamente." };

  await advanceStep(supabase, restaurant, 4);
  return { status: "idle" };
}

// ---------------------------------------------------------------------------
// Passo 5 — horários de funcionamento
// ---------------------------------------------------------------------------

export async function savePasso5Action(_prev: StepActionState, formData: FormData): Promise<StepActionState> {
  const { supabase, restaurant } = await requireRestaurant();

  const rows = WEEK_DAYS.map(({ value }) => {
    const isOpen = formData.get(`is_open_${value}`) === "on";
    const opensAt = String(formData.get(`opens_at_${value}`) ?? "");
    const closesAt = String(formData.get(`closes_at_${value}`) ?? "");
    return {
      restaurant_id: restaurant.id,
      day_of_week: value,
      is_open: isOpen,
      opens_at: isOpen && opensAt ? opensAt : null,
      closes_at: isOpen && closesAt ? closesAt : null,
    };
  });

  const anyOpenMissingHours = rows.some((row) => row.is_open && (!row.opens_at || !row.closes_at));
  if (anyOpenMissingHours) {
    return { status: "error", message: "Informe horário de abertura e fechamento para os dias abertos." };
  }

  const { error } = await supabase
    .from("business_hours")
    .upsert(rows, { onConflict: "restaurant_id,day_of_week" });
  if (error) return { status: "error", message: "Não foi possível salvar os horários. Tente novamente." };

  await advanceStep(supabase, restaurant, 5);
  return { status: "idle" };
}

// ---------------------------------------------------------------------------
// Passo 6 — formas de pagamento
// ---------------------------------------------------------------------------

export async function savePasso6Action(_prev: StepActionState, formData: FormData): Promise<StepActionState> {
  const { supabase, restaurant } = await requireRestaurant();

  const paymentPix = formData.get("payment_pix") === "on";
  const paymentCash = formData.get("payment_cash") === "on";
  const paymentCard = formData.get("payment_card") === "on";
  const pixKey = String(formData.get("payment_pix_key") ?? "").trim();

  if (!paymentPix && !paymentCash && !paymentCard) {
    return { status: "error", message: "Selecione ao menos uma forma de pagamento." };
  }
  if (paymentPix && !pixKey) {
    return { status: "error", message: "Informe a chave Pix do restaurante." };
  }

  const { error } = await supabase
    .from("restaurants")
    .update({
      payment_pix: paymentPix,
      payment_pix_key: paymentPix ? pixKey : null,
      payment_cash: paymentCash,
      payment_card: paymentCard,
    })
    .eq("id", restaurant.id);
  if (error) return { status: "error", message: "Não foi possível salvar. Tente novamente." };

  await advanceStep(supabase, restaurant, 6);
  return { status: "idle" };
}

// ---------------------------------------------------------------------------
// Passo 7 — primeiro produto (finaliza o onboarding)
// ---------------------------------------------------------------------------

export async function savePasso7Action(_prev: StepActionState, formData: FormData): Promise<StepActionState> {
  const { supabase, restaurant } = await requireRestaurant();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const priceRaw = String(formData.get("price") ?? "").replace(",", ".");
  const imageUrl = String(formData.get("image_url") ?? "").trim() || null;

  if (!name) return { status: "error", message: "Informe o nome do produto." };
  if (!priceRaw || Number.isNaN(Number(priceRaw)) || Number(priceRaw) < 0) {
    return { status: "error", message: "Informe um preço válido." };
  }

  const { error } = await supabase.from("products").insert({
    restaurant_id: restaurant.id,
    name,
    description,
    price: Number(priceRaw),
    image_url: imageUrl,
  });
  if (error) return { status: "error", message: "Não foi possível salvar o produto. Tente novamente." };

  await advanceStep(supabase, restaurant, 7);
  return { status: "idle" };
}
