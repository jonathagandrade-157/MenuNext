"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMyRestaurant, type Restaurant } from "@/lib/tenant";
import type { AddonActionState } from "@/lib/form-state";
import {
  ADDON_GROUP_MAX_SELECTIONS_LIMIT,
  validateAddonDescription,
  validateAddonGroupDescription,
  validateAddonGroupName,
  validateAddonGroupSelectionRules,
  validateAddonName,
  validateAddonPrice,
} from "@/lib/addons";

export type { AddonActionState };

const ADICIONAIS_PATH = "/painel/adicionais";
const PRODUCTS_PATH = "/painel/produtos";

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

function friendlyAddonError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("required_needs_min")) {
    return "Um grupo obrigatório precisa de um mínimo de seleções de pelo menos 1.";
  }
  if (normalized.includes("min_greater_than_max")) return "O mínimo de seleções não pode ser maior que o máximo.";
  if (normalized.includes("invalid_min")) return "Informe um mínimo de seleções válido.";
  if (normalized.includes("invalid_max")) {
    return `Informe um máximo de seleções entre 1 e ${ADDON_GROUP_MAX_SELECTIONS_LIMIT}.`;
  }
  if (normalized.includes("invalid_price")) return "Informe um preço adicional válido (maior ou igual a zero).";
  if (normalized.includes("invalid_group")) return "Grupo de adicionais inválido.";
  if (normalized.includes("association_duplicate") || normalized.includes("duplicate key")) {
    return "Este grupo já está associado a este produto.";
  }
  if (normalized.includes("name_too_long")) return "O nome é muito longo.";
  if (normalized.includes("description_too_long")) return "A descrição é muito longa.";
  if (normalized.includes("invalid_name")) return "Informe o nome.";
  if (normalized.includes("not_authorized")) return "Registro não encontrado.";
  return "Não foi possível concluir. Tente novamente.";
}

function parseIntField(formData: FormData, field: string): number {
  const raw = String(formData.get(field) ?? "").trim();
  const value = Number(raw);
  return Number.isInteger(value) ? value : NaN;
}

// ---------------------------------------------------------------------------
// Grupos de adicionais
// ---------------------------------------------------------------------------

export async function createAddonGroupAction(
  _prev: AddonActionState,
  formData: FormData
): Promise<AddonActionState> {
  const { supabase, restaurant } = await requireRestaurant();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const isRequired = formData.get("isRequired") === "on";
  const isActive = formData.get("isActive") === "on";
  const minSelections = parseIntField(formData, "minSelections");
  const maxSelections = parseIntField(formData, "maxSelections");

  const nameValidation = validateAddonGroupName(name);
  if (!nameValidation.ok) return { status: "error", message: nameValidation.error };
  const descriptionValidation = validateAddonGroupDescription(description);
  if (!descriptionValidation.ok) return { status: "error", message: descriptionValidation.error };
  const rulesValidation = validateAddonGroupSelectionRules(minSelections, maxSelections, isRequired);
  if (!rulesValidation.ok) return { status: "error", message: rulesValidation.error };

  // create_addon_group sempre cria o grupo ativo (padrão da tabela) — se o
  // formulário pediu "Ativo" desmarcado, um segundo UPDATE (já coberto por
  // RLS/is_restaurant_member) ajusta na sequência, sem precisar de um novo
  // parâmetro na RPC.
  const { data: created, error } = await supabase.rpc("create_addon_group", {
    p_restaurant_id: restaurant.id,
    p_name: name,
    p_description: description || null,
    p_min_selections: rulesValidation.minSelections,
    p_max_selections: rulesValidation.maxSelections,
    p_is_required: rulesValidation.isRequired,
  });

  if (error) return { status: "error", message: friendlyAddonError(error.message) };

  if (!isActive && created) {
    await supabase.from("addon_groups").update({ is_active: false }).eq("id", created.id);
  }

  revalidatePath(ADICIONAIS_PATH);
  return { status: "success" };
}

export async function updateAddonGroupAction(
  _prev: AddonActionState,
  formData: FormData
): Promise<AddonActionState> {
  const { supabase } = await requireRestaurant();

  const groupId = String(formData.get("groupId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const isRequired = formData.get("isRequired") === "on";
  const isActive = formData.get("isActive") === "on";
  const minSelections = parseIntField(formData, "minSelections");
  const maxSelections = parseIntField(formData, "maxSelections");

  if (!groupId) return { status: "error", message: "Grupo inválido." };
  const nameValidation = validateAddonGroupName(name);
  if (!nameValidation.ok) return { status: "error", message: nameValidation.error };
  const descriptionValidation = validateAddonGroupDescription(description);
  if (!descriptionValidation.ok) return { status: "error", message: descriptionValidation.error };
  const rulesValidation = validateAddonGroupSelectionRules(minSelections, maxSelections, isRequired);
  if (!rulesValidation.ok) return { status: "error", message: rulesValidation.error };

  const { error } = await supabase.rpc("update_addon_group", {
    p_group_id: groupId,
    p_name: name,
    p_description: description || null,
    p_min_selections: rulesValidation.minSelections,
    p_max_selections: rulesValidation.maxSelections,
    p_is_required: rulesValidation.isRequired,
  });

  if (error) return { status: "error", message: friendlyAddonError(error.message) };

  // update_addon_group não mexe em is_active (RPC dedicada só a nome/regras
  // de seleção) — o campo "Ativo" do mesmo formulário é aplicado aqui como um
  // segundo UPDATE, coberto pelas mesmas policies de RLS.
  await supabase.from("addon_groups").update({ is_active: isActive }).eq("id", groupId);

  revalidatePath(ADICIONAIS_PATH);
  return { status: "success" };
}

export async function toggleAddonGroupActiveAction(
  groupId: string,
  nextActive: boolean
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { data, error } = await supabase
    .from("addon_groups")
    .update({ is_active: nextActive })
    .eq("id", groupId)
    .select("id");

  if (error) return { ok: false, error: "Não foi possível atualizar. Tente novamente." };
  if (!data || data.length === 0) return { ok: false, error: "Grupo não encontrado." };

  revalidatePath(ADICIONAIS_PATH);
  return { ok: true };
}

// Excluir grupo — o próprio banco já recusaria (addons.addon_group_id sem
// cascade), a contagem aqui só dá uma mensagem amigável com o número real de
// itens, em vez de deixar o erro de FK estourar cru para o usuário.
export async function deleteAddonGroupAction(groupId: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { count, error: countError } = await supabase
    .from("addons")
    .select("id", { count: "exact", head: true })
    .eq("addon_group_id", groupId);
  if (countError) return { ok: false, error: "Não foi possível verificar os adicionais deste grupo." };
  if (count && count > 0) {
    return {
      ok: false,
      error: `Este grupo possui ${count} adicional${count > 1 ? "is" : ""}. Remova ou mova os adicionais antes de excluir o grupo.`,
    };
  }

  const { data, error } = await supabase.from("addon_groups").delete().eq("id", groupId).select("id");

  if (error) return { ok: false, error: "Não foi possível excluir. Tente novamente." };
  if (!data || data.length === 0) return { ok: false, error: "Grupo não encontrado." };

  revalidatePath(ADICIONAIS_PATH);
  revalidatePath(PRODUCTS_PATH);
  return { ok: true };
}

export async function moveAddonGroupAction(
  groupId: string,
  direction: "up" | "down"
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { error } = await supabase.rpc("move_addon_group", { p_group_id: groupId, p_direction: direction });
  if (error) return { ok: false, error: "Não foi possível reordenar. Tente novamente." };

  revalidatePath(ADICIONAIS_PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Itens (adicionais) de um grupo
// ---------------------------------------------------------------------------

export async function createAddonAction(_prev: AddonActionState, formData: FormData): Promise<AddonActionState> {
  const { supabase, restaurant } = await requireRestaurant();

  const addonGroupId = String(formData.get("addonGroupId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const isAvailable = formData.get("isAvailable") === "on";

  if (!addonGroupId) return { status: "error", message: "Grupo inválido." };
  const nameValidation = validateAddonName(name);
  if (!nameValidation.ok) return { status: "error", message: nameValidation.error };
  const descriptionValidation = validateAddonDescription(description);
  if (!descriptionValidation.ok) return { status: "error", message: descriptionValidation.error };
  const priceValidation = validateAddonPrice(String(formData.get("price") ?? ""));
  if (!priceValidation.ok) return { status: "error", message: priceValidation.error };

  const { error } = await supabase.rpc("create_addon", {
    p_restaurant_id: restaurant.id,
    p_addon_group_id: addonGroupId,
    p_name: name,
    p_description: description || null,
    p_price: priceValidation.value,
    p_is_available: isAvailable,
  });

  if (error) return { status: "error", message: friendlyAddonError(error.message) };

  revalidatePath(ADICIONAIS_PATH);
  return { status: "success" };
}

export async function updateAddonAction(_prev: AddonActionState, formData: FormData): Promise<AddonActionState> {
  const { supabase } = await requireRestaurant();

  const addonId = String(formData.get("addonId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const isAvailable = formData.get("isAvailable") === "on";

  if (!addonId) return { status: "error", message: "Adicional inválido." };
  const nameValidation = validateAddonName(name);
  if (!nameValidation.ok) return { status: "error", message: nameValidation.error };
  const descriptionValidation = validateAddonDescription(description);
  if (!descriptionValidation.ok) return { status: "error", message: descriptionValidation.error };
  const priceValidation = validateAddonPrice(String(formData.get("price") ?? ""));
  if (!priceValidation.ok) return { status: "error", message: priceValidation.error };

  const { error } = await supabase.rpc("update_addon", {
    p_addon_id: addonId,
    p_name: name,
    p_description: description || null,
    p_price: priceValidation.value,
    p_is_available: isAvailable,
  });

  if (error) return { status: "error", message: friendlyAddonError(error.message) };

  revalidatePath(ADICIONAIS_PATH);
  return { status: "success" };
}

export async function toggleAddonAvailableAction(
  addonId: string,
  nextAvailable: boolean
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { data, error } = await supabase
    .from("addons")
    .update({ is_available: nextAvailable })
    .eq("id", addonId)
    .select("id");

  if (error) return { ok: false, error: "Não foi possível atualizar. Tente novamente." };
  if (!data || data.length === 0) return { ok: false, error: "Adicional não encontrado." };

  revalidatePath(ADICIONAIS_PATH);
  return { ok: true };
}

// Excluir item — remove só o item; grupo, produtos e outros itens nunca são
// afetados (sem cascade nenhum envolvido aqui).
export async function deleteAddonAction(addonId: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { data, error } = await supabase.from("addons").delete().eq("id", addonId).select("id");

  if (error) return { ok: false, error: "Não foi possível excluir. Tente novamente." };
  if (!data || data.length === 0) return { ok: false, error: "Adicional não encontrado." };

  revalidatePath(ADICIONAIS_PATH);
  return { ok: true };
}

export async function moveAddonAction(
  addonId: string,
  direction: "up" | "down"
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { error } = await supabase.rpc("move_addon", { p_addon_id: addonId, p_direction: direction });
  if (error) return { ok: false, error: "Não foi possível reordenar. Tente novamente." };

  revalidatePath(ADICIONAIS_PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Associação grupo <-> produto (gerida na tela de edição do produto)
// ---------------------------------------------------------------------------

// Associar — via RPC add_product_addon_group: o restaurant_id é determinado
// a partir do PRÓPRIO produto no servidor, e o grupo é validado como sendo
// do mesmo tenant antes de inserir (nunca confia em restaurant_id do cliente).
export async function addProductAddonGroupAction(
  productId: string,
  addonGroupId: string
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { error } = await supabase.rpc("add_product_addon_group", {
    p_product_id: productId,
    p_addon_group_id: addonGroupId,
  });

  if (error) return { ok: false, error: friendlyAddonError(error.message) };

  revalidatePath(PRODUCTS_PATH);
  return { ok: true };
}

// Remover — DELETE direto: RLS já garante que só associações do próprio
// restaurante podem ser removidas; remove só a associação, nunca o grupo ou
// o produto.
export async function removeProductAddonGroupAction(
  associationId: string
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { data, error } = await supabase
    .from("product_addon_groups")
    .delete()
    .eq("id", associationId)
    .select("id");

  if (error) return { ok: false, error: "Não foi possível remover. Tente novamente." };
  if (!data || data.length === 0) return { ok: false, error: "Associação não encontrada." };

  revalidatePath(PRODUCTS_PATH);
  return { ok: true };
}

export async function moveProductAddonGroupAction(
  associationId: string,
  direction: "up" | "down"
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { error } = await supabase.rpc("move_product_addon_group", {
    p_association_id: associationId,
    p_direction: direction,
  });
  if (error) return { ok: false, error: "Não foi possível reordenar. Tente novamente." };

  revalidatePath(PRODUCTS_PATH);
  return { ok: true };
}
