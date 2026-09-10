"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMyRestaurant, type Restaurant } from "@/lib/tenant";
import type { ComboActionState } from "@/lib/form-state";
import {
  COMBO_ITEM_QUANTITY_MAX,
  validateComboDescription,
  validateComboDraftItems,
  validateComboItemQuantity,
  validateComboName,
  validateComboPrice,
  type ComboDraftItem,
} from "@/lib/combos";
import { deleteComboImage, uploadComboImage, validateImageFile } from "@/lib/storage/assets";

export type { ComboActionState };

const COMBOS_PATH = "/painel/combos";

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

function friendlyComboError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid_price")) return "Informe um preço válido, maior que zero.";
  if (normalized.includes("invalid_quantity")) {
    return `Informe uma quantidade válida (entre 1 e ${COMBO_ITEM_QUANTITY_MAX}).`;
  }
  if (normalized.includes("invalid_product")) return "Selecione um produto válido do seu cardápio.";
  if (normalized.includes("item_duplicate") || normalized.includes("duplicate key")) {
    return "Este produto já faz parte deste combo.";
  }
  if (normalized.includes("name_too_long")) return "O nome do combo é muito longo.";
  if (normalized.includes("description_too_long")) return "A descrição é muito longa.";
  if (normalized.includes("invalid_name")) return "Informe o nome do combo.";
  if (normalized.includes("not_authorized")) return "Registro não encontrado.";
  return "Não foi possível concluir. Tente novamente.";
}

function parseDraftItems(raw: string): ComboDraftItem[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((entry) => ({
      productId: String(entry.productId ?? ""),
      quantity: Number(entry.quantity),
    }));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Criar — via RPC create_combo (restaurant_id/display_order determinados no
// servidor) + inserção de cada item da composição via add_combo_item. Um
// combo nunca é persistido vazio: se a composição ou a imagem falhar, o
// combo recém-criado é excluído (o ON DELETE CASCADE de combo_items cuida
// de remover qualquer item já inserido).
// ---------------------------------------------------------------------------
export async function createComboAction(_prev: ComboActionState, formData: FormData): Promise<ComboActionState> {
  const { supabase, restaurant } = await requireRestaurant();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const isAvailable = formData.get("isAvailable") === "on";
  const itemsRaw = String(formData.get("itemsJson") ?? "[]");
  const image = formData.get("image");

  const nameValidation = validateComboName(name);
  if (!nameValidation.ok) return { status: "error", message: nameValidation.error };
  const descriptionValidation = validateComboDescription(description);
  if (!descriptionValidation.ok) return { status: "error", message: descriptionValidation.error };
  const priceValidation = validateComboPrice(String(formData.get("price") ?? ""));
  if (!priceValidation.ok) return { status: "error", message: priceValidation.error };

  const draftItems = parseDraftItems(itemsRaw);
  if (!draftItems) return { status: "error", message: "Composição do combo inválida." };
  const itemsValidation = validateComboDraftItems(draftItems);
  if (!itemsValidation.ok) return { status: "error", message: itemsValidation.error };

  const imageFile = image instanceof File && image.size > 0 ? image : null;
  if (imageFile) {
    const validation = await validateImageFile(imageFile);
    if (!validation.ok) return { status: "error", message: validation.error };
  }

  const { data: combo, error } = await supabase.rpc("create_combo", {
    p_restaurant_id: restaurant.id,
    p_name: name,
    p_description: description || null,
    p_price: priceValidation.value,
    p_is_available: isAvailable,
  });

  if (error) return { status: "error", message: friendlyComboError(error.message) };

  for (const item of draftItems) {
    const { error: itemError } = await supabase.rpc("add_combo_item", {
      p_combo_id: combo.id,
      p_product_id: item.productId,
      p_quantity: item.quantity,
    });
    if (itemError) {
      await supabase.from("combos").delete().eq("id", combo.id);
      return { status: "error", message: friendlyComboError(itemError.message) };
    }
  }

  if (imageFile) {
    const uploadResult = await uploadComboImage(supabase, { restaurantId: restaurant.id, comboId: combo.id, file: imageFile });
    if (!uploadResult.ok) {
      await supabase.from("combos").delete().eq("id", combo.id);
      return { status: "error", message: "Não foi possível salvar a imagem do combo. O combo não foi criado — tente novamente." };
    }
  }

  revalidatePath(COMBOS_PATH);
  return { status: "success" };
}

// ---------------------------------------------------------------------------
// Editar campos do combo (composição e imagem são geridas por ações
// separadas abaixo, mesmo padrão de produtos/imagens e grupos/itens).
// ---------------------------------------------------------------------------
export async function updateComboAction(_prev: ComboActionState, formData: FormData): Promise<ComboActionState> {
  const { supabase } = await requireRestaurant();

  const comboId = String(formData.get("comboId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const isAvailable = formData.get("isAvailable") === "on";

  if (!comboId) return { status: "error", message: "Combo inválido." };
  const nameValidation = validateComboName(name);
  if (!nameValidation.ok) return { status: "error", message: nameValidation.error };
  const descriptionValidation = validateComboDescription(description);
  if (!descriptionValidation.ok) return { status: "error", message: descriptionValidation.error };
  const priceValidation = validateComboPrice(String(formData.get("price") ?? ""));
  if (!priceValidation.ok) return { status: "error", message: priceValidation.error };

  const { error } = await supabase.rpc("update_combo", {
    p_combo_id: comboId,
    p_name: name,
    p_description: description || null,
    p_price: priceValidation.value,
    p_is_available: isAvailable,
  });

  if (error) return { status: "error", message: friendlyComboError(error.message) };

  revalidatePath(COMBOS_PATH);
  return { status: "success" };
}

export async function toggleComboAvailableAction(
  comboId: string,
  nextAvailable: boolean
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { data, error } = await supabase
    .from("combos")
    .update({ is_available: nextAvailable })
    .eq("id", comboId)
    .select("id");

  if (error) return { ok: false, error: "Não foi possível atualizar. Tente novamente." };
  if (!data || data.length === 0) return { ok: false, error: "Combo não encontrado." };

  revalidatePath(COMBOS_PATH);
  return { ok: true };
}

// Excluir combo — remove só a composição (combo_items, via ON DELETE
// CASCADE); nunca remove products/categories/addons.
export async function deleteComboAction(comboId: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { data, error } = await supabase.from("combos").delete().eq("id", comboId).select("id");

  if (error) return { ok: false, error: "Não foi possível excluir. Tente novamente." };
  if (!data || data.length === 0) return { ok: false, error: "Combo não encontrado." };

  revalidatePath(COMBOS_PATH);
  return { ok: true };
}

export async function moveComboAction(
  comboId: string,
  direction: "up" | "down"
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { error } = await supabase.rpc("move_combo", { p_combo_id: comboId, p_direction: direction });
  if (error) return { ok: false, error: "Não foi possível reordenar. Tente novamente." };

  revalidatePath(COMBOS_PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Composição do combo — adicionar/editar/remover/reordenar produtos.
// ---------------------------------------------------------------------------

// Adicionar — via RPC add_combo_item: o restaurant_id é determinado a partir
// do PRÓPRIO combo no servidor, e o produto é validado como sendo do mesmo
// tenant antes de inserir (nunca confia em product_id arbitrário do cliente).
export async function addComboItemAction(
  comboId: string,
  productId: string,
  quantity: number
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const quantityValidation = validateComboItemQuantity(quantity);
  if (!quantityValidation.ok) return { ok: false, error: quantityValidation.error };

  const { error } = await supabase.rpc("add_combo_item", {
    p_combo_id: comboId,
    p_product_id: productId,
    p_quantity: quantityValidation.value,
  });

  if (error) return { ok: false, error: friendlyComboError(error.message) };

  revalidatePath(COMBOS_PATH);
  return { ok: true };
}

export async function updateComboItemAction(
  itemId: string,
  quantity: number
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const quantityValidation = validateComboItemQuantity(quantity);
  if (!quantityValidation.ok) return { ok: false, error: quantityValidation.error };

  const { error } = await supabase.rpc("update_combo_item", {
    p_item_id: itemId,
    p_quantity: quantityValidation.value,
  });

  if (error) return { ok: false, error: friendlyComboError(error.message) };

  revalidatePath(COMBOS_PATH);
  return { ok: true };
}

// Remover — nunca deixa o combo sem nenhum produto: se este for o último
// item, a remoção é bloqueada com uma mensagem amigável (o combo já não
// pôde ser salvo vazio na criação; a mesma garantia vale depois, na edição).
export async function removeComboItemAction(itemId: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { data: item, error: fetchError } = await supabase
    .from("combo_items")
    .select("combo_id")
    .eq("id", itemId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: "Não foi possível localizar o item." };
  if (!item) return { ok: false, error: "Item não encontrado." };

  const { count, error: countError } = await supabase
    .from("combo_items")
    .select("id", { count: "exact", head: true })
    .eq("combo_id", item.combo_id);
  if (countError) return { ok: false, error: "Não foi possível verificar a composição do combo." };
  if (count !== null && count <= 1) {
    return { ok: false, error: "O combo precisa ter pelo menos um produto. Adicione outro produto antes de remover este." };
  }

  const { data, error } = await supabase.from("combo_items").delete().eq("id", itemId).select("id");
  if (error) return { ok: false, error: "Não foi possível remover. Tente novamente." };
  if (!data || data.length === 0) return { ok: false, error: "Item não encontrado." };

  revalidatePath(COMBOS_PATH);
  return { ok: true };
}

export async function moveComboItemAction(
  itemId: string,
  direction: "up" | "down"
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { error } = await supabase.rpc("move_combo_item", { p_item_id: itemId, p_direction: direction });
  if (error) return { ok: false, error: "Não foi possível reordenar. Tente novamente." };

  revalidatePath(COMBOS_PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Imagem do combo — 1 única imagem (não é galeria). Reaproveita a
// infraestrutura de Storage existente (bucket restaurant-assets).
// ---------------------------------------------------------------------------
export async function uploadComboImageAction(comboId: string, file: File): Promise<{ ok: boolean; error?: string }> {
  const { supabase, restaurant } = await requireRestaurant();

  const { data: combo, error: comboError } = await supabase
    .from("combos")
    .select("id, image_path")
    .eq("id", comboId)
    .maybeSingle();
  if (comboError) return { ok: false, error: "Não foi possível verificar o combo." };
  if (!combo) return { ok: false, error: "Combo não encontrado." };

  const validation = await validateImageFile(file);
  if (!validation.ok) return { ok: false, error: validation.error };

  const result = await uploadComboImage(supabase, { restaurantId: restaurant.id, comboId, file });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(COMBOS_PATH);
  return { ok: true };
}

export async function removeComboImageAction(comboId: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { data: combo, error: fetchError } = await supabase
    .from("combos")
    .select("image_path")
    .eq("id", comboId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: "Não foi possível localizar o combo." };
  if (!combo) return { ok: false, error: "Combo não encontrado." };
  if (!combo.image_path) return { ok: true };

  const result = await deleteComboImage(supabase, { comboId, imagePath: combo.image_path });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(COMBOS_PATH);
  return { ok: true };
}
