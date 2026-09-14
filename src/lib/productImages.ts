/**
 * Regras puras de posicionamento da galeria de imagens de produto — o banco
 * continua usando display_order 1..5 (mesmo range desde a Fase 1.5/2.2,
 * nenhuma migration necessária). "Principal" nunca é um campo separado: é
 * sempre a imagem de MENOR display_order entre as existentes de um produto.
 * Excluir a principal automaticamente promove a próxima só por ordenar
 * corretamente em todo lugar que lê product_images — nenhum código extra.
 */

// Import relativo: o vitest deste projeto não resolve o alias "@/" em
// runtime para imports de VALOR (só tipos, que são erasados em build) — ver
// mesmo ajuste em src/lib/orders.ts.
import { MAX_PRODUCT_IMAGES } from "./storage/assets";

export type ProductImageOrder = { id: string; display_order: number };

/**
 * Próximo display_order para uma NOVA imagem: sempre depois da última
 * existente, nunca reocupa um buraco deixado por uma exclusão anterior.
 * Isso é o que impede uma foto adicionada depois de excluir a principal de
 * "roubar" a posição 1 sem o lojista ter pedido — o slot 1 só volta a ser
 * ocupado se o produto ficar completamente sem imagens. `null` quando o
 * produto já está no limite de MAX_PRODUCT_IMAGES.
 */
export function nextProductImageDisplayOrder(existingOrders: number[]): number | null {
  if (existingOrders.length >= MAX_PRODUCT_IMAGES) return null;
  if (existingOrders.length === 0) return 1;
  return Math.max(...existingOrders) + 1;
}

export function sortProductImagesByDisplayOrder<T extends ProductImageOrder>(images: T[]): T[] {
  return [...images].sort((a, b) => a.display_order - b.display_order);
}

/** A principal é sempre a de menor display_order, ou null se não há imagem. */
export function getPrimaryProductImage<T extends ProductImageOrder>(images: T[]): T | null {
  return sortProductImagesByDisplayOrder(images)[0] ?? null;
}

export function isPrimaryProductImage<T extends ProductImageOrder>(image: T, allImages: T[]): boolean {
  const primary = getPrimaryProductImage(allImages);
  return primary !== null && primary.id === image.id;
}

/**
 * Quantos passos "mover para a esquerda" (RPC move_product_image, que só
 * troca vizinhos adjacentes) são necessários para `imageId` se tornar a
 * principal. "Definir como principal" é só andar até a posição de menor
 * display_order, um passo por vez — reaproveita a RPC existente, sem
 * precisar de uma nova.
 */
export function stepsToPromoteToPrimary<T extends ProductImageOrder>(images: T[], imageId: string): number {
  const sorted = sortProductImagesByDisplayOrder(images);
  const index = sorted.findIndex((image) => image.id === imageId);
  return index === -1 ? 0 : index;
}
