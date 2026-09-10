"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMyRestaurant, type Restaurant } from "@/lib/tenant";
import type { CategoryActionState } from "@/lib/form-state";
import {
  CATEGORY_NAME_MAX_LENGTH,
  CATEGORY_DESCRIPTION_MAX_LENGTH,
  validateCategoryDescription,
  validateCategoryName,
} from "@/lib/categories";

export type { CategoryActionState };

const CATEGORIES_PATH = "/painel/categorias";

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

function friendlyCategoryError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("category_duplicate") || normalized.includes("duplicate key")) {
    return "Já existe uma categoria com esse nome.";
  }
  if (normalized.includes("name_too_long")) {
    return `O nome deve ter até ${CATEGORY_NAME_MAX_LENGTH} caracteres.`;
  }
  if (normalized.includes("description_too_long")) {
    return `A descrição deve ter até ${CATEGORY_DESCRIPTION_MAX_LENGTH} caracteres.`;
  }
  if (normalized.includes("invalid_name")) {
    return "Informe o nome da categoria.";
  }
  return "Não foi possível concluir. Tente novamente.";
}

// ---------------------------------------------------------------------------
// Criar — via RPC create_category: quem determina o restaurant_id e o
// display_order é o servidor, não o formulário.
// ---------------------------------------------------------------------------
export async function createCategoryAction(
  _prev: CategoryActionState,
  formData: FormData
): Promise<CategoryActionState> {
  const { supabase, restaurant } = await requireRestaurant();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  const nameValidation = validateCategoryName(name);
  if (!nameValidation.ok) return { status: "error", message: nameValidation.error };
  const descriptionValidation = validateCategoryDescription(description);
  if (!descriptionValidation.ok) return { status: "error", message: descriptionValidation.error };

  const { error } = await supabase.rpc("create_category", {
    p_restaurant_id: restaurant.id,
    p_name: name,
    p_description: description || null,
  });

  if (error) return { status: "error", message: friendlyCategoryError(error.message) };

  revalidatePath(CATEGORIES_PATH);
  return { status: "success" };
}

// ---------------------------------------------------------------------------
// Editar — UPDATE direto: RLS já garante que só a própria categoria pode
// ser alterada; o índice único (restaurant_id, lower(trim(name))) garante
// que não dá pra renomear para um nome já usado no mesmo restaurante.
// ---------------------------------------------------------------------------
export async function updateCategoryAction(
  _prev: CategoryActionState,
  formData: FormData
): Promise<CategoryActionState> {
  const { supabase } = await requireRestaurant();

  const categoryId = String(formData.get("categoryId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!categoryId) return { status: "error", message: "Categoria inválida." };
  const nameValidation = validateCategoryName(name);
  if (!nameValidation.ok) return { status: "error", message: nameValidation.error };
  const descriptionValidation = validateCategoryDescription(description);
  if (!descriptionValidation.ok) return { status: "error", message: descriptionValidation.error };

  const { data, error } = await supabase
    .from("categories")
    .update({ name, description: description || null })
    .eq("id", categoryId)
    .select("id");

  if (error) return { status: "error", message: friendlyCategoryError(error.message) };
  // RLS filtra silenciosamente: 0 linhas = categoria inexistente ou de outro
  // restaurante — nos dois casos a resposta certa é a mesma, sem vazar qual.
  if (!data || data.length === 0) return { status: "error", message: "Categoria não encontrada." };

  revalidatePath(CATEGORIES_PATH);
  return { status: "success" };
}

// ---------------------------------------------------------------------------
// Ativar/desativar — não é formulário, é um clique isolado (toggle).
// ---------------------------------------------------------------------------
export async function toggleCategoryActiveAction(
  categoryId: string,
  nextActive: boolean
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { data, error } = await supabase
    .from("categories")
    .update({ is_active: nextActive })
    .eq("id", categoryId)
    .select("id");

  if (error) return { ok: false, error: "Não foi possível atualizar. Tente novamente." };
  if (!data || data.length === 0) return { ok: false, error: "Categoria não encontrada." };

  revalidatePath(CATEGORIES_PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Excluir — desde a Fase 2.2, products.category_id existe e tem uma FK sem
// cascade (products -> categories), então o próprio banco já recusaria o
// DELETE se houvesse produtos vinculados. A contagem aqui é só para dar uma
// mensagem amigável com o número real de produtos, em vez de deixar o erro
// de FK estourar cru para o usuário.
// ---------------------------------------------------------------------------
export async function deleteCategoryAction(categoryId: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { count, error: countError } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("category_id", categoryId);
  if (countError) return { ok: false, error: "Não foi possível verificar produtos vinculados." };
  if (count && count > 0) {
    return {
      ok: false,
      error: `Esta categoria possui ${count} produto${count > 1 ? "s" : ""}. Mova os produtos para outra categoria antes de excluir.`,
    };
  }

  const { data, error } = await supabase.from("categories").delete().eq("id", categoryId).select("id");

  if (error) return { ok: false, error: "Não foi possível excluir. Tente novamente." };
  if (!data || data.length === 0) return { ok: false, error: "Categoria não encontrada." };

  revalidatePath(CATEGORIES_PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reordenar — via RPC move_category: troca o display_order com o vizinho
// numa única transação (a unique constraint é deferrable para permitir a
// troca). Preparado para D&D futuro: a interface só precisa mandar a
// direção (ou, no futuro, a nova posição); o mecanismo de persistência não
// muda.
// ---------------------------------------------------------------------------
export async function moveCategoryAction(
  categoryId: string,
  direction: "up" | "down"
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { error } = await supabase.rpc("move_category", {
    p_category_id: categoryId,
    p_direction: direction,
  });

  if (error) return { ok: false, error: "Não foi possível reordenar. Tente novamente." };

  revalidatePath(CATEGORIES_PATH);
  return { ok: true };
}
