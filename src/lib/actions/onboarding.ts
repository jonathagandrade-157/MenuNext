"use server";

import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMyRestaurant, getOnboardingProgress, ONBOARDING_STEP_PATHS, type Restaurant } from "@/lib/tenant";
import type { StepActionState } from "@/lib/form-state";
import { WEEK_DAYS } from "@/lib/form-state";
import { validateProductDescription, validateProductName, validateProductPrice } from "@/lib/products";
import { uploadProductImage } from "@/lib/storage/assets";

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

/**
 * Avança para o próximo passo (ou finaliza o onboarding guiado, no passo 7)
 * — usada tanto por um envio real de formulário (`markCompleted = true`,
 * marca o passo em `completed_steps`) quanto por "Pular por enquanto"
 * (`markCompleted = false`: avança current_step normalmente, mas NUNCA
 * marca o passo como concluído — "pular" significa "vou fazer depois", não
 * "está configurado". A conclusão real de cada área é sempre calculada a
 * partir dos dados de verdade no checklist do painel, nunca deste array).
 *
 * Chegar ao fim do passo 7 (concluindo ou pulando) sempre finaliza o
 * onboarding guiado (onboarding_completed = true, status = 'active') — é o
 * único gatilho de ativação da loja hoje; o checklist do painel continua
 * guiando o lojista a completar o resto depois, sem bloquear nada.
 */
async function advanceStep(
  supabase: SupabaseClient,
  restaurant: Restaurant,
  step: number,
  markCompleted: boolean
) {
  const isLastStep = step >= 7;
  const nextStep = Math.min(step + 1, 7);

  const progress = await getOnboardingProgress(supabase, restaurant.id);
  const completedSteps = markCompleted
    ? Array.from(new Set([...(progress?.completed_steps ?? []), step])).sort((a, b) => a - b)
    : (progress?.completed_steps ?? []);

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

/**
 * "Pular por enquanto" — mesma ação para qualquer passo 2-7 (usada via
 * `.bind(null, step)` como `formAction` de um botão dentro do mesmo
 * `<form>` do passo, com `formNoValidate` para nunca exigir os campos
 * obrigatórios daquele passo). Nunca apaga dado já preenchido (não
 * sobrescreve nenhuma coluna), só avança o progresso.
 */
export async function skipOnboardingStepAction(step: number): Promise<void> {
  const { supabase, restaurant } = await requireRestaurant();
  await advanceStep(supabase, restaurant, step, false);
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
  await advanceStep(supabase, restaurant as Restaurant, 1, true);
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

  await advanceStep(supabase, restaurant, 2, true);
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

  await advanceStep(supabase, restaurant, 3, true);
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

  await advanceStep(supabase, restaurant, 4, true);
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

  await advanceStep(supabase, restaurant, 5, true);
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

  await advanceStep(supabase, restaurant, 6, true);
  return { status: "idle" };
}

// ---------------------------------------------------------------------------
// Passo 7 — primeiro produto (finaliza o onboarding)
// ---------------------------------------------------------------------------

/**
 * Cadastra o primeiro produto (opcional) e finaliza o onboarding guiado —
 * reaproveita a mesma RPC create_product (restaurant_id/display_order
 * determinados no servidor) e o mesmo helper de upload real de imagem
 * (uploadProductImage, bucket restaurant-assets) já usados em
 * src/lib/actions/products.ts, nunca uma segunda implementação. Como
 * products.category_id é NOT NULL e o onboarding não tem uma etapa própria
 * de categorias, cria idempotentemente uma categoria padrão ("Cardápio") se
 * o restaurante ainda não tiver nenhuma — só quando necessário, nunca
 * duplicando se já existir alguma.
 */
export async function savePasso7Action(_prev: StepActionState, formData: FormData): Promise<StepActionState> {
  const { supabase, restaurant } = await requireRestaurant();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const priceRaw = String(formData.get("price") ?? "").replace(",", ".");
  const categoryIdInput = String(formData.get("categoryId") ?? "").trim();
  const imageFile = formData.get("image");

  const nameValidation = validateProductName(name);
  if (!nameValidation.ok) return { status: "error", message: nameValidation.error };
  const descriptionValidation = validateProductDescription(description);
  if (!descriptionValidation.ok) return { status: "error", message: descriptionValidation.error };
  const priceValidation = validateProductPrice(priceRaw);
  if (!priceValidation.ok) return { status: "error", message: priceValidation.error };

  let categoryId = categoryIdInput;
  if (!categoryId) {
    const { count, error: countError } = await supabase
      .from("categories")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurant.id);
    if (countError) return { status: "error", message: "Não foi possível verificar as categorias. Tente novamente." };

    if (count && count > 0) {
      return { status: "error", message: "Selecione uma categoria." };
    }

    const { data: defaultCategory, error: categoryError } = await supabase.rpc("create_category", {
      p_restaurant_id: restaurant.id,
      p_name: "Cardápio",
    });
    if (categoryError) return { status: "error", message: "Não foi possível criar a categoria padrão. Tente novamente." };
    categoryId = (defaultCategory as { id: string }).id;
  }

  const { data: product, error } = await supabase.rpc("create_product", {
    p_restaurant_id: restaurant.id,
    p_category_id: categoryId,
    p_name: name,
    p_description: description || null,
    p_price: priceValidation.value,
    p_cost: null,
    p_is_available: true,
  });
  if (error) return { status: "error", message: "Não foi possível salvar o produto. Tente novamente." };

  if (imageFile instanceof File && imageFile.size > 0) {
    const uploadResult = await uploadProductImage(supabase, {
      restaurantId: restaurant.id,
      productId: product.id,
      displayOrder: 1,
      file: imageFile,
    });
    if (!uploadResult.ok) {
      // Produto parcialmente configurado não é uma opção — mesma regra de
      // createProductAction: desfaz o produto se a foto falhar ao salvar.
      await supabase.from("products").delete().eq("id", product.id);
      return { status: "error", message: uploadResult.error };
    }
  }

  await advanceStep(supabase, restaurant, 7, true);
  return { status: "idle" };
}
