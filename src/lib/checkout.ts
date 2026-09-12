/**
 * Regras puras do checkout — dados do cliente (guest), entrega/retirada e
 * pagamento — compartilhadas pelo formulário client-side (CheckoutClient) e
 * pelos testes. A garantia real é SEMPRE repetida no servidor (RPC
 * create_order, migration add_public_checkout_and_orders.sql): preço,
 * disponibilidade, min/max de adicionais e total nunca confiam no que roda
 * aqui — isto é só a camada de UX (feedback imediato antes de chamar o
 * servidor).
 */

import type { BagItem } from "@/lib/bag";

export type FieldValidation = { ok: true } | { ok: false; error: string };

export type FulfillmentType = "delivery" | "pickup";
export type PaymentMethod = "pix" | "cash" | "card";

export const FULFILLMENT_TYPE_LABELS: Record<FulfillmentType, string> = {
  delivery: "Entrega",
  pickup: "Retirada",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: "Pix",
  cash: "Dinheiro",
  card: "Cartão na entrega/retirada",
};

/** Rótulos de status — reaproveitados pela tela de confirmação. A máquina de
 * estados em si vive só no banco (CHECK constraint de orders.status); este
 * mapa é apenas apresentação. */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  received: "Recebido",
  confirmed: "Confirmado",
  preparing: "Em preparo",
  ready: "Pronto",
  out_for_delivery: "Saiu para entrega",
  delivered: "Entregue",
  picked_up: "Retirado",
  cancelled: "Cancelado",
};

export const CUSTOMER_NAME_MAX_LENGTH = 120;
export const CHECKOUT_OBSERVATION_MAX_LENGTH = 300;

export function validateCustomerName(rawName: string): FieldValidation {
  const name = rawName.trim();
  if (!name) return { ok: false, error: "Informe seu nome." };
  if (name.length > CUSTOMER_NAME_MAX_LENGTH) {
    return { ok: false, error: `O nome deve ter até ${CUSTOMER_NAME_MAX_LENGTH} caracteres.` };
  }
  return { ok: true };
}

/** Aceita telefone brasileiro com DDD (10 dígitos fixo, 11 celular), com ou sem formatação. */
export function validateCustomerPhone(rawPhone: string): FieldValidation {
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 11) {
    return { ok: false, error: "Informe um telefone válido, com DDD." };
  }
  return { ok: true };
}

export type DeliveryAddressInput = {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
};

export function validateDeliveryAddress(address: DeliveryAddressInput): FieldValidation {
  if (!address.street.trim()) return { ok: false, error: "Informe a rua." };
  if (!address.number.trim()) return { ok: false, error: "Informe o número." };
  if (!address.neighborhood.trim()) return { ok: false, error: "Informe o bairro." };
  if (!address.city.trim()) return { ok: false, error: "Informe a cidade." };
  return { ok: true };
}

/** `changeFor` (troco para) é opcional — null significa "sem troco/valor exato". */
export function validateChangeFor(changeFor: number | null, total: number): FieldValidation {
  if (changeFor === null) return { ok: true };
  if (!Number.isFinite(changeFor) || changeFor < 0) {
    return { ok: false, error: "Informe um valor de troco válido." };
  }
  if (changeFor < total) {
    return { ok: false, error: "O valor para troco deve ser maior ou igual ao total do pedido." };
  }
  return { ok: true };
}

/** Pedido mínimo é opcional (null = sem exigência) — mesma checagem que o
 * servidor repete em create_order (nunca confiamos só nisto aqui: é feedback
 * imediato antes de chamar a RPC, que sempre recalcula o subtotal real). */
export function validateMinimumOrder(subtotal: number, minimumOrderValue: number | null): FieldValidation {
  if (minimumOrderValue === null) return { ok: true };
  if (subtotal < minimumOrderValue) {
    return {
      ok: false,
      error: `O pedido mínimo desta loja é ${minimumOrderValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`,
    };
  }
  return { ok: true };
}

export function validateCheckoutObservation(observation: string): FieldValidation {
  if (observation.length > CHECKOUT_OBSERVATION_MAX_LENGTH) {
    return { ok: false, error: `A observação deve ter até ${CHECKOUT_OBSERVATION_MAX_LENGTH} caracteres.` };
  }
  return { ok: true };
}

/** Payload de UM item que vai para a RPC create_order — só a intenção de
 * compra (id/quantidade/adicionais/observação). NUNCA inclui preço,
 * subtotal ou qualquer valor calculado: o servidor recalcula tudo a partir
 * do banco. */
export type CreateOrderItemPayload = {
  product_id: string;
  quantity: number;
  observation: string | null;
  addon_ids: string[];
};

export function buildOrderItemsPayload(items: BagItem[]): CreateOrderItemPayload[] {
  return items.map((item) => ({
    product_id: item.productId,
    quantity: item.quantity,
    observation: item.observation || null,
    addon_ids: item.selectedAddons.map((addon) => addon.addonId),
  }));
}

/** Chave de idempotência gerada no cliente — o servidor a usa (UNIQUE por
 * restaurante) para garantir que reenviar a mesma tentativa (duplo clique,
 * reload, retry de rede) nunca cria um segundo pedido. */
export function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
