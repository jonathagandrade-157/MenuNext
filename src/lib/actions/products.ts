"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMyRestaurant, type Restaurant } from "@/lib/tenant";
import type { ProductActionState } from "@/lib/form-state";
import { validateProductCost, validateProductDescription, validateProductName, validateProductPrice } from "@/lib/products";
import {
  MAX_PRODUCT_IMAGES,
  RESTAURANT_ASSETS_BUCKET,
  deleteProductImage,
  uploadProductImage,
  validateImageFile,
} from "@/lib/storage/assets";
import { nextProductImageDisplayOrder, stepsToPromoteToPrimary } from "@/lib/productImages";

export type { ProductActionState };

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

function friendlyProductError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid_category")) return "Selecione uma categoria válida.";
  if (normalized.includes("invalid_price")) return "Informe um preço válido, maior que zero.";
  if (normalized.includes("invalid_cost")) return "Informe um custo válido (maior ou igual a zero).";
  if (normalized.includes("name_too_long")) return "O nome do produto é muito longo.";
  if (normalized.includes("description_too_long")) return "A descrição é muito longa.";
  if (normalized.includes("invalid_name")) return "Informe o nome do produto.";
  if (normalized.includes("not_authorized")) return "Produto não encontrado.";
  return "Não foi possível concluir. Tente novamente.";
}

function readFiles(formData: FormData, field: string): File[] {
  return formData.getAll(field).filter((entry): entry is File => entry instanceof File && entry.size > 0);
}

// ---------------------------------------------------------------------------
// Criar — via RPC create_product (restaurant_id/tenant/ordem determinados no
// servidor). Upload das imagens só acontece DEPOIS do produto criado; se
// qualquer imagem falhar, desfazemos tudo (storage já enviado + o produto)
// para nunca deixar um produto parcialmente configurado.
// ---------------------------------------------------------------------------
export async function createProductAction(
  _prev: ProductActionState,
  formData: FormData
): Promise<ProductActionState> {
  const { supabase, restaurant } = await requireRestaurant();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const categoryId = String(formData.get("categoryId") ?? "");
  const isAvailable = formData.get("isAvailable") === "on";

  const nameValidation = validateProductName(name);
  if (!nameValidation.ok) return { status: "error", message: nameValidation.error };
  const descriptionValidation = validateProductDescription(description);
  if (!descriptionValidation.ok) return { status: "error", message: descriptionValidation.error };
  if (!categoryId) return { status: "error", message: "Selecione uma categoria." };
  const priceValidation = validateProductPrice(String(formData.get("price") ?? ""));
  if (!priceValidation.ok) return { status: "error", message: priceValidation.error };
  const costValidation = validateProductCost(String(formData.get("cost") ?? ""));
  if (!costValidation.ok) return { status: "error", message: costValidation.error };

  const files = readFiles(formData, "images");
  if (files.length > MAX_PRODUCT_IMAGES) {
    return { status: "error", message: `Envie no máximo ${MAX_PRODUCT_IMAGES} imagens.` };
  }
  // Validação de todas as imagens ANTES de criar o produto — um arquivo
  // inválido não deve nem chegar a criar a linha em products.
  for (const file of files) {
    const validation = await validateImageFile(file);
    if (!validation.ok) return { status: "error", message: validation.error };
  }

  const { data: product, error } = await supabase.rpc("create_product", {
    p_restaurant_id: restaurant.id,
    p_category_id: categoryId,
    p_name: name,
    p_description: description || null,
    p_price: priceValidation.value,
    p_cost: costValidation.value,
    p_is_available: isAvailable,
  });

  if (error) return { status: "error", message: friendlyProductError(error.message) };

  const uploadedPaths: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const result = await uploadProductImage(supabase, {
      restaurantId: restaurant.id,
      productId: product.id,
      displayOrder: i + 1,
      file: files[i],
    });
    if (!result.ok) {
      // Produto parcialmente configurado não é uma opção: desfaz upload(s)
      // já feitos e remove o produto recém-criado.
      if (uploadedPaths.length > 0) {
        await supabase.storage.from(RESTAURANT_ASSETS_BUCKET).remove(uploadedPaths);
      }
      await supabase.from("products").delete().eq("id", product.id);
      return {
        status: "error",
        message: "Não foi possível salvar as imagens do produto. O produto não foi criado — tente novamente.",
      };
    }
    uploadedPaths.push(result.path);
  }

  revalidatePath(PRODUCTS_PATH);
  redirect(PRODUCTS_PATH);
}

// ---------------------------------------------------------------------------
// Editar campos do produto (imagens são geridas por ações separadas abaixo).
// ---------------------------------------------------------------------------
export async function updateProductAction(
  _prev: ProductActionState,
  formData: FormData
): Promise<ProductActionState> {
  const { supabase } = await requireRestaurant();

  const productId = String(formData.get("productId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const categoryId = String(formData.get("categoryId") ?? "");
  const isAvailable = formData.get("isAvailable") === "on";

  if (!productId) return { status: "error", message: "Produto inválido." };
  const nameValidation = validateProductName(name);
  if (!nameValidation.ok) return { status: "error", message: nameValidation.error };
  const descriptionValidation = validateProductDescription(description);
  if (!descriptionValidation.ok) return { status: "error", message: descriptionValidation.error };
  if (!categoryId) return { status: "error", message: "Selecione uma categoria." };
  const priceValidation = validateProductPrice(String(formData.get("price") ?? ""));
  if (!priceValidation.ok) return { status: "error", message: priceValidation.error };
  const costValidation = validateProductCost(String(formData.get("cost") ?? ""));
  if (!costValidation.ok) return { status: "error", message: costValidation.error };

  const { error } = await supabase.rpc("update_product", {
    p_product_id: productId,
    p_category_id: categoryId,
    p_name: name,
    p_description: description || null,
    p_price: priceValidation.value,
    p_cost: costValidation.value,
    p_is_available: isAvailable,
  });

  if (error) return { status: "error", message: friendlyProductError(error.message) };

  revalidatePath(PRODUCTS_PATH);
  return { status: "success" };
}

// ---------------------------------------------------------------------------
// Disponibilidade — toggle isolado, persistido na hora.
// ---------------------------------------------------------------------------
export async function toggleProductAvailableAction(
  productId: string,
  nextAvailable: boolean
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { data, error } = await supabase
    .from("products")
    .update({ is_available: nextAvailable })
    .eq("id", productId)
    .select("id");

  if (error) return { ok: false, error: "Não foi possível atualizar. Tente novamente." };
  if (!data || data.length === 0) return { ok: false, error: "Produto não encontrado." };

  revalidatePath(PRODUCTS_PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reordenar produto dentro da própria categoria.
// ---------------------------------------------------------------------------
export async function moveProductAction(
  productId: string,
  direction: "up" | "down"
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { error } = await supabase.rpc("move_product", { p_product_id: productId, p_direction: direction });
  if (error) return { ok: false, error: "Não foi possível reordenar. Tente novamente." };

  revalidatePath(PRODUCTS_PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Excluir produto — remove os arquivos do Storage primeiro (o cascade do
// banco cuida das linhas de product_images quando o produto é apagado).
// ---------------------------------------------------------------------------
export async function deleteProductAction(productId: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  // products -> combo_items não tem cascade (Fase 2.4): o próprio banco já
  // recusaria a exclusão de um produto usado em algum combo. A contagem
  // aqui só dá uma mensagem amigável com o número real de combos, em vez de
  // deixar o erro de FK estourar cru para o usuário.
  const { count: comboCount, error: comboCountError } = await supabase
    .from("combo_items")
    .select("combo_id", { count: "exact", head: true })
    .eq("product_id", productId);
  if (comboCountError) return { ok: false, error: "Não foi possível verificar combos vinculados." };
  if (comboCount && comboCount > 0) {
    return {
      ok: false,
      error: `Este produto faz parte de ${comboCount} combo${comboCount > 1 ? "s" : ""}. Remova-o dos combos antes de excluir.`,
    };
  }

  const { data: images, error: fetchError } = await supabase
    .from("product_images")
    .select("storage_path")
    .eq("product_id", productId);
  if (fetchError) return { ok: false, error: "Não foi possível excluir. Tente novamente." };

  if (images && images.length > 0) {
    const { error: removeError } = await supabase.storage
      .from(RESTAURANT_ASSETS_BUCKET)
      .remove(images.map((image) => image.storage_path));
    if (removeError) return { ok: false, error: "Não foi possível remover as imagens do produto. Tente novamente." };
  }

  const { data, error } = await supabase.from("products").delete().eq("id", productId).select("id");
  if (error) return { ok: false, error: "Não foi possível excluir. Tente novamente." };
  if (!data || data.length === 0) return { ok: false, error: "Produto não encontrado." };

  revalidatePath(PRODUCTS_PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Imagens — adicionar (no primeiro slot livre de 1..5), remover, reordenar.
// Reaproveita src/lib/storage/assets.ts (Fase 1.5) por inteiro.
// ---------------------------------------------------------------------------
export async function addProductImageAction(
  productId: string,
  file: File
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, restaurant } = await requireRestaurant();

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id")
    .eq("id", productId)
    .eq("restaurant_id", restaurant.id)
    .maybeSingle();
  if (productError) return { ok: false, error: "Não foi possível verificar o produto." };
  if (!product) return { ok: false, error: "Produto não encontrado." };

  const { data: existing, error: fetchError } = await supabase
    .from("product_images")
    .select("display_order")
    .eq("product_id", productId);
  if (fetchError) return { ok: false, error: "Não foi possível verificar as imagens existentes." };

  // Sempre depois da última existente — nunca reocupa um buraco deixado por
  // uma exclusão anterior (ver src/lib/productImages.ts). Reocupar o slot 1
  // faria uma foto nova "roubar" a posição de principal sem o lojista ter
  // pedido isso.
  const slot = nextProductImageDisplayOrder((existing ?? []).map((row) => row.display_order));
  if (slot === null) {
    return { ok: false, error: `Este produto já tem o máximo de ${MAX_PRODUCT_IMAGES} imagens.` };
  }

  const validation = await validateImageFile(file);
  if (!validation.ok) return { ok: false, error: validation.error };

  const result = await uploadProductImage(supabase, { restaurantId: restaurant.id, productId, displayOrder: slot, file });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(PRODUCTS_PATH);
  return { ok: true };
}

export async function removeProductImageAction(imageId: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const result = await deleteProductImage(supabase, { imageId });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(PRODUCTS_PATH);
  return { ok: true };
}

export async function moveProductImageAction(
  imageId: string,
  direction: "up" | "down"
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { error } = await supabase.rpc("move_product_image", { p_image_id: imageId, p_direction: direction });
  if (error) return { ok: false, error: "Não foi possível reordenar a imagem. Tente novamente." };

  revalidatePath(PRODUCTS_PATH);
  return { ok: true };
}

/**
 * "Definir como principal" — a principal é sempre a imagem de menor
 * display_order (nunca um campo separado, ver src/lib/productImages.ts).
 * Promover uma imagem é só andar até essa posição usando a MESMA RPC de
 * reordenar (move_product_image, que só troca vizinhos adjacentes) uma vez
 * por passo — nenhuma RPC nova. Cada passo é sua própria transação; se um
 * passo no meio do caminho falhar, a imagem fica mais perto da posição 1 do
 * que estava (nunca num estado inválido), e o lojista pode tentar de novo.
 */
export async function setPrimaryProductImageAction(imageId: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { data: image, error: imageError } = await supabase
    .from("product_images")
    .select("id, product_id")
    .eq("id", imageId)
    .maybeSingle();
  if (imageError) return { ok: false, error: "Não foi possível localizar a imagem." };
  if (!image) return { ok: false, error: "Imagem não encontrada." };

  const { data: siblings, error: siblingsError } = await supabase
    .from("product_images")
    .select("id, display_order")
    .eq("product_id", image.product_id);
  if (siblingsError) return { ok: false, error: "Não foi possível verificar as imagens do produto." };

  const steps = stepsToPromoteToPrimary(siblings ?? [], imageId);
  for (let i = 0; i < steps; i++) {
    const { error } = await supabase.rpc("move_product_image", { p_image_id: imageId, p_direction: "up" });
    if (error) return { ok: false, error: "Não foi possível definir como principal. Tente novamente." };
  }

  revalidatePath(PRODUCTS_PATH);
  return { ok: true };
}
