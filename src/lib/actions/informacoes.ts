"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMyRestaurant, type Restaurant } from "@/lib/tenant";
import type { InformacoesActionState } from "@/lib/form-state";

const INFORMACOES_PATH = "/painel/informacoes";

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

const COMBINING_DIACRITICS_RANGE_START = 0x0300;
const COMBINING_DIACRITICS_RANGE_END = 0x036f;

/** Mesma normalização de slug do Passo 1 do onboarding (src/lib/actions/onboarding.ts)
 * — duplicada aqui deliberadamente, em vez de importada, para não tocar em
 * nenhum arquivo do onboarding nesta fase. */
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

/**
 * Edição de nome/slug/endereço do restaurante já existente (Fase de
 * separação onboarding/painel) — NUNCA usa a RPC create_restaurant (que é
 * só para criação, idempotente: se chamada de novo, apenas retorna o
 * restaurante existente sem atualizar nada). Aqui é um UPDATE direto,
 * protegido pela mesma RLS de sempre (restaurants_update_members ->
 * is_restaurant_member), igual a savePasso2Action. Ao salvar, permanece em
 * /painel/informacoes — nunca redireciona para o onboarding.
 */
export async function saveInformacoesAction(
  _prev: InformacoesActionState,
  formData: FormData
): Promise<InformacoesActionState> {
  const { supabase, restaurant } = await requireRestaurant();

  const name = String(formData.get("name") ?? "").trim();
  const slug = normalizeSlug(String(formData.get("slug") ?? ""));
  const address = {
    address_zip: String(formData.get("zip") ?? "").trim(),
    address_street: String(formData.get("street") ?? "").trim(),
    address_number: String(formData.get("number") ?? "").trim(),
    address_complement: String(formData.get("complement") ?? "").trim() || null,
    address_neighborhood: String(formData.get("neighborhood") ?? "").trim(),
    address_city: String(formData.get("city") ?? "").trim(),
    address_state: String(formData.get("state") ?? "").trim(),
  };

  if (!name) return { status: "error", message: "Informe o nome do restaurante." };
  if (slug.length < 3) {
    return { status: "error", message: "Escolha uma URL com pelo menos 3 caracteres (letras, números e hífen)." };
  }
  if (!address.address_zip || !address.address_street || !address.address_city || !address.address_state) {
    return { status: "error", message: "Preencha CEP, endereço, cidade e estado." };
  }

  // Checagem de unicidade só quando o slug realmente muda — is_slug_available
  // (RPC pública, mesma usada no Passo 1) enxerga todos os restaurantes via
  // SECURITY DEFINER, mas não sabe distinguir "já é meu" de "é de outro
  // tenant"; pular a checagem quando o slug não muda evita um falso "já em
  // uso" contra o próprio restaurante.
  if (slug !== restaurant.slug) {
    const { data: available, error: slugCheckError } = await supabase.rpc("is_slug_available", { p_slug: slug });
    if (slugCheckError) return { status: "error", message: "Não foi possível verificar a URL. Tente novamente." };
    if (!available) return { status: "error", message: "Essa URL já está em uso. Escolha outra." };
  }

  const { error } = await supabase
    .from("restaurants")
    .update({ name, slug, ...address })
    .eq("id", restaurant.id);

  if (error) {
    if (error.code === "23505") {
      return { status: "error", message: "Essa URL já está em uso. Escolha outra." };
    }
    return { status: "error", message: "Não foi possível salvar. Tente novamente." };
  }

  revalidatePath(INFORMACOES_PATH);
  revalidatePath("/painel");
  return { status: "success" };
}
