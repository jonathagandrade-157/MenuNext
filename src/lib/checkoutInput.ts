/**
 * Formato máximo aceito nas Server Actions do checkout. Server Action é chamável por qualquer um com o corpo que
 * quiser (o limite de corpo do Next aqui é 30 MB, por causa dos uploads de imagem): sem estes tetos, uma única
 * requisição aceita pelos limites de tentativas poderia mandar milhares de linhas de item ou endereços gigantes para o
 * banco. Os tetos ficam muito acima de qualquer pedido real e NÃO mudam nenhuma regra comercial.
 */
export const CHECKOUT_LIMITS = {
  slug: 80,
  name: 120,
  phone: 30,
  addressField: 200,
  observation: 300,
  itemObservation: 200,
  idempotencyKey: 100,
  couponCode: 64,
  captchaToken: 2048,
  itemLines: 100,
  addonsPerLine: 50,
  idLength: 64,
} as const;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => v === null || v === undefined || (typeof v === "string" && v.length <= max);

export function isValidItemsShape(items: unknown): boolean {
  if (!Array.isArray(items) || items.length === 0 || items.length > CHECKOUT_LIMITS.itemLines) return false;
  return items.every((item) => {
    if (!isObject(item)) return false;
    if (typeof item.product_id !== "string" || item.product_id.length === 0 || item.product_id.length > CHECKOUT_LIMITS.idLength) return false;
    if (!Number.isInteger(item.quantity) || (item.quantity as number) < 1 || (item.quantity as number) > 99) return false;
    if (!text(item.observation, CHECKOUT_LIMITS.itemObservation)) return false;
    const addons = item.addon_ids;
    if (addons !== undefined && addons !== null) {
      if (!Array.isArray(addons) || addons.length > CHECKOUT_LIMITS.addonsPerLine) return false;
      if (!addons.every((a) => typeof a === "string" && a.length > 0 && a.length <= CHECKOUT_LIMITS.idLength)) return false;
    }
    return true;
  });
}

/** Confere só TIPOS e TAMANHOS (a regra de negócio é do banco). Devolve true se o corpo tem formato aceitável. */
export function isValidOrderShape(input: unknown): boolean {
  if (!isObject(input)) return false;
  const L = CHECKOUT_LIMITS;
  if (typeof input.slug !== "string" || input.slug.length === 0 || input.slug.length > L.slug) return false;
  if (typeof input.customerName !== "string" || input.customerName.length > L.name) return false;
  if (typeof input.customerPhone !== "string" || input.customerPhone.length > L.phone) return false;
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length === 0 || input.idempotencyKey.length > L.idempotencyKey) return false;
  if (!text(input.observation, L.observation) || !text(input.couponCode, L.couponCode)) return false;
  if (!text(input.captchaToken, L.captchaToken)) return false;
  if (input.changeFor !== null && input.changeFor !== undefined && (typeof input.changeFor !== "number" || !Number.isFinite(input.changeFor))) return false;
  if (typeof input.paymentMethod !== "string") return false;
  if (input.delivery !== null && input.delivery !== undefined) {
    if (!isObject(input.delivery)) return false;
    for (const key of ["zip", "street", "number", "complement", "neighborhood", "city", "state", "reference"]) {
      if (!text(input.delivery[key], L.addressField)) return false;
    }
  }
  return isValidItemsShape(input.items);
}

export function isValidCouponRequest(slug: unknown, code: unknown, subtotal: unknown): boolean {
  return (
    typeof slug === "string" && slug.length > 0 && slug.length <= CHECKOUT_LIMITS.slug &&
    typeof code === "string" && code.length > 0 && code.length <= CHECKOUT_LIMITS.couponCode &&
    typeof subtotal === "number" && Number.isFinite(subtotal) && subtotal >= 0
  );
}
