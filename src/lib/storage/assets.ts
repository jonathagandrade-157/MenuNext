/**
 * Camada reutilizável de upload de imagens/assets do MenuNext (Supabase
 * Storage, bucket `restaurant-assets`). Cobre logo/capa do restaurante e
 * imagens de produto — pensada para banners/promoções reaproveitarem o
 * mesmo núcleo depois, sem recriar upload/validação.
 *
 * O path de cada asset é sempre {restaurant_id}/... (nunca o nome original
 * do arquivo) — é esse prefixo que as policies de storage.objects usam
 * para garantir isolamento entre restaurantes (ver migration
 * add_restaurant_assets_storage).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const RESTAURANT_ASSETS_BUCKET = "restaurant-assets";

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB — não aumentar sem necessidade real.

export const MAX_PRODUCT_IMAGES = 5;

export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

const EXTENSION_BY_MIME_TYPE: Record<AllowedImageMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function isAllowedMimeType(value: string): value is AllowedImageMimeType {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * Identifica o formato real de uma imagem pelos primeiros bytes (magic
 * numbers), em vez de confiar no `file.type` declarado pelo navegador —
 * que pode ser forjado por quem chamar a API diretamente. Um SVG (texto
 * XML), HTML ou executável nunca batem com nenhuma destas assinaturas.
 */
export function sniffImageMimeType(bytes: Uint8Array): AllowedImageMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export type ImageValidationResult =
  | { ok: true; extension: string; mimeType: AllowedImageMimeType }
  | { ok: false; error: string };

/**
 * Valida um arquivo de imagem antes do upload: tamanho, MIME declarado E
 * conteúdo real (magic bytes). Não converte/otimiza nada — isso fica para
 * uma etapa futura (ver decisão sobre WebP no relatório da Fase 1.5).
 */
export async function validateImageFile(file: File): Promise<ImageValidationResult> {
  if (file.size <= 0) {
    return { ok: false, error: "Arquivo vazio." };
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return { ok: false, error: "A imagem deve ter no máximo 5 MB." };
  }
  if (!isAllowedMimeType(file.type)) {
    return { ok: false, error: "Formato não aceito. Envie uma imagem JPEG, PNG ou WebP." };
  }

  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const sniffed = sniffImageMimeType(header);
  if (!sniffed || sniffed !== file.type) {
    return { ok: false, error: "O conteúdo do arquivo não corresponde a uma imagem válida." };
  }

  return { ok: true, extension: EXTENSION_BY_MIME_TYPE[sniffed], mimeType: sniffed };
}

// ---------------------------------------------------------------------------
// Paths — sempre {restaurant_id}/... e nunca derivados do nome original do
// arquivo. É este prefixo que as policies de storage.objects verificam.
// ---------------------------------------------------------------------------

export function restaurantLogoPath(restaurantId: string, extension: string): string {
  return `${restaurantId}/branding/logo.${extension}`;
}

export function restaurantCoverPath(restaurantId: string, extension: string): string {
  return `${restaurantId}/branding/cover.${extension}`;
}

export function productImagePath(
  restaurantId: string,
  productId: string,
  displayOrder: number,
  extension: string
): string {
  if (!Number.isInteger(displayOrder) || displayOrder < 1 || displayOrder > MAX_PRODUCT_IMAGES) {
    throw new Error(`displayOrder deve ser um inteiro entre 1 e ${MAX_PRODUCT_IMAGES}.`);
  }
  return `${restaurantId}/products/${productId}/${displayOrder}.${extension}`;
}

export function bannerPath(restaurantId: string, assetId: string, extension: string): string {
  return `${restaurantId}/banners/${assetId}.${extension}`;
}

export function comboImagePath(restaurantId: string, comboId: string, extension: string): string {
  return `${restaurantId}/combos/${comboId}/image.${extension}`;
}

// ---------------------------------------------------------------------------
// Upload/leitura — sempre via cliente autenticado comum (anon key + sessão
// do usuário); nunca service_role. RLS + as policies do bucket fazem a
// autorização de verdade.
// ---------------------------------------------------------------------------

export type UploadResult = { ok: true; path: string } | { ok: false; error: string };

async function uploadToBucket(supabase: SupabaseClient, path: string, file: File, contentType: string): Promise<UploadResult> {
  const { error } = await supabase.storage.from(RESTAURANT_ASSETS_BUCKET).upload(path, file, {
    contentType,
    upsert: true,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, path };
}

/** URL pública de um asset do bucket (bucket é público para leitura). */
export function getPublicAssetUrl(supabase: SupabaseClient, path: string): string {
  return supabase.storage.from(RESTAURANT_ASSETS_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function uploadRestaurantLogo(supabase: SupabaseClient, restaurantId: string, file: File): Promise<UploadResult> {
  const validation = await validateImageFile(file);
  if (!validation.ok) return validation;

  const path = restaurantLogoPath(restaurantId, validation.extension);
  const uploaded = await uploadToBucket(supabase, path, file, validation.mimeType);
  if (!uploaded.ok) return uploaded;

  const { error } = await supabase.from("restaurants").update({ logo_path: path }).eq("id", restaurantId);
  if (error) {
    await supabase.storage.from(RESTAURANT_ASSETS_BUCKET).remove([path]);
    return { ok: false, error: "Não foi possível salvar o logo. Tente novamente." };
  }
  return { ok: true, path };
}

export async function uploadRestaurantCover(supabase: SupabaseClient, restaurantId: string, file: File): Promise<UploadResult> {
  const validation = await validateImageFile(file);
  if (!validation.ok) return validation;

  const path = restaurantCoverPath(restaurantId, validation.extension);
  const uploaded = await uploadToBucket(supabase, path, file, validation.mimeType);
  if (!uploaded.ok) return uploaded;

  const { error } = await supabase.from("restaurants").update({ cover_path: path }).eq("id", restaurantId);
  if (error) {
    await supabase.storage.from(RESTAURANT_ASSETS_BUCKET).remove([path]);
    return { ok: false, error: "Não foi possível salvar a capa. Tente novamente." };
  }
  return { ok: true, path };
}

export async function uploadProductImage(
  supabase: SupabaseClient,
  params: { restaurantId: string; productId: string; displayOrder: number; file: File }
): Promise<UploadResult> {
  const { restaurantId, productId, displayOrder, file } = params;

  const validation = await validateImageFile(file);
  if (!validation.ok) return validation;

  const path = productImagePath(restaurantId, productId, displayOrder, validation.extension);
  const uploaded = await uploadToBucket(supabase, path, file, validation.mimeType);
  if (!uploaded.ok) return uploaded;

  const { error } = await supabase
    .from("product_images")
    .upsert(
      { restaurant_id: restaurantId, product_id: productId, storage_path: path, display_order: displayOrder },
      { onConflict: "product_id,display_order" }
    );
  if (error) {
    await supabase.storage.from(RESTAURANT_ASSETS_BUCKET).remove([path]);
    return { ok: false, error: "Não foi possível salvar a imagem do produto. Tente novamente." };
  }
  return { ok: true, path };
}

/**
 * Imagem única do combo (não é galeria, ao contrário de produto): substitui
 * qualquer arquivo anterior no mesmo path fixo ({restaurant_id}/combos/
 * {combo_id}/image.{ext}) e grava o path em combos.image_path — mesmo
 * padrão de uploadRestaurantLogo/uploadRestaurantCover.
 */
export async function uploadComboImage(
  supabase: SupabaseClient,
  params: { restaurantId: string; comboId: string; file: File }
): Promise<UploadResult> {
  const { restaurantId, comboId, file } = params;

  const validation = await validateImageFile(file);
  if (!validation.ok) return validation;

  const path = comboImagePath(restaurantId, comboId, validation.extension);
  const uploaded = await uploadToBucket(supabase, path, file, validation.mimeType);
  if (!uploaded.ok) return uploaded;

  const { error } = await supabase.from("combos").update({ image_path: path }).eq("id", comboId);
  if (error) {
    await supabase.storage.from(RESTAURANT_ASSETS_BUCKET).remove([path]);
    return { ok: false, error: "Não foi possível salvar a imagem do combo. Tente novamente." };
  }
  return { ok: true, path };
}

export async function deleteComboImage(
  supabase: SupabaseClient,
  params: { comboId: string; imagePath: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error: storageError } = await supabase.storage.from(RESTAURANT_ASSETS_BUCKET).remove([params.imagePath]);
  if (storageError) {
    return { ok: false, error: "Não foi possível remover o arquivo. Tente novamente." };
  }

  const { error: updateError } = await supabase.from("combos").update({ image_path: null }).eq("id", params.comboId);
  if (updateError) {
    return { ok: false, error: "Arquivo removido, mas não foi possível atualizar o registro. Tente novamente." };
  }
  return { ok: true };
}

export async function deleteProductImage(
  supabase: SupabaseClient,
  params: { imageId: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: image, error: fetchError } = await supabase
    .from("product_images")
    .select("storage_path")
    .eq("id", params.imageId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: "Não foi possível localizar a imagem." };
  if (!image) return { ok: true }; // já não existe (ou não é do restaurante do usuário) — nada a fazer.

  // Storage primeiro: só apaga o registro do banco se o arquivo realmente
  // saiu (ou já não existia), evitando um registro apontando para um
  // arquivo inexistente.
  const { error: storageError } = await supabase.storage.from(RESTAURANT_ASSETS_BUCKET).remove([image.storage_path]);
  if (storageError) {
    return { ok: false, error: "Não foi possível remover o arquivo. Tente novamente." };
  }

  const { error: deleteError } = await supabase.from("product_images").delete().eq("id", params.imageId);
  if (deleteError) {
    return { ok: false, error: "Arquivo removido, mas não foi possível atualizar o registro. Tente novamente." };
  }
  return { ok: true };
}
