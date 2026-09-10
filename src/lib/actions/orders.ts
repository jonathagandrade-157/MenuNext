"use server";

import { createClient } from "@/lib/supabase/server";
import type { CreateOrderItemPayload } from "@/lib/checkout";

export type SubmitOrderDeliveryInput = {
  zip: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  reference: string;
};

export type SubmitOrderInput = {
  slug: string;
  customerName: string;
  customerPhone: string;
  fulfillmentType: "delivery" | "pickup";
  delivery: SubmitOrderDeliveryInput | null;
  paymentMethod: "pix" | "cash" | "card";
  changeFor: number | null;
  observation: string;
  items: CreateOrderItemPayload[];
  idempotencyKey: string;
};

export type SubmitOrderResult =
  | { status: "success"; publicId: string; orderNumber: number }
  | { status: "error"; message: string };

// Nunca deixa um erro técnico (PostgrestError cru) chegar ao cliente — o
// pedido continua na sacola em qualquer caso de erro (nada é limpo aqui,
// só o chamador decide isso após "success"). Mesmo padrão de
// friendlyProductError em src/lib/actions/products.ts.
function friendlyOrderError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("restaurant_not_found")) return "Esta loja não está disponível no momento.";
  if (normalized.includes("restaurant_unavailable")) {
    return "Esta loja está pausada ou fechada no momento e não está aceitando pedidos.";
  }
  if (normalized.includes("restaurant_closed")) return "Esta loja está fora do horário de funcionamento no momento.";
  if (normalized.includes("invalid_name")) return "Informe seu nome.";
  if (normalized.includes("invalid_phone")) return "Informe um telefone válido, com DDD.";
  if (normalized.includes("invalid_fulfillment_type")) return "Selecione entrega ou retirada.";
  if (normalized.includes("delivery_not_available")) return "Esta loja não oferece entrega no momento.";
  if (normalized.includes("pickup_not_available")) return "Esta loja não oferece retirada no momento.";
  if (normalized.includes("invalid_address")) return "Preencha o endereço de entrega completo.";
  if (normalized.includes("invalid_payment_method")) return "Selecione uma forma de pagamento válida.";
  if (normalized.includes("invalid_change")) return "O valor para troco deve ser maior ou igual ao total do pedido.";
  if (normalized.includes("empty_cart")) return "Sua sacola está vazia.";
  if (normalized.includes("invalid_quantity")) return "Quantidade inválida em algum item da sacola.";
  if (normalized.includes("observation_too_long")) return "A observação é muito longa.";
  if (normalized.includes("product_not_found")) {
    return "Um dos produtos da sua sacola não está mais disponível nesta loja. Revise a sacola.";
  }
  if (normalized.includes("product_unavailable")) {
    return "Um dos produtos da sua sacola ficou indisponível. Revise a sacola.";
  }
  if (normalized.includes("addon_not_linked_to_product") || normalized.includes("addon_not_found")) {
    return "Um dos adicionais escolhidos não é mais válido. Revise a sacola.";
  }
  if (normalized.includes("addon_unavailable")) {
    return "Um dos adicionais escolhidos ficou indisponível. Revise a sacola.";
  }
  if (normalized.includes("addon_group_inactive")) {
    return "Um grupo de adicionais escolhido não está mais disponível. Revise a sacola.";
  }
  if (normalized.includes("addon_group_selection_invalid")) {
    return "A seleção de adicionais de algum item da sacola não é mais válida. Revise a sacola.";
  }
  return "Não foi possível finalizar o pedido. Seus itens continuam na sacola. Tente novamente.";
}

/**
 * Cria o pedido — guest checkout, sem login. Chamada diretamente do client
 * component do checkout (Server Action comum, não presa a um <form
 * action>). Toda a validação/segurança real acontece na RPC create_order
 * (SECURITY DEFINER): esta função só traduz o retorno para algo seguro de
 * mostrar ao cliente, nunca confia em nada calculado no navegador.
 */
export async function submitOrderAction(input: SubmitOrderInput): Promise<SubmitOrderResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("create_order", {
    p_slug: input.slug,
    p_customer_name: input.customerName,
    p_customer_phone: input.customerPhone,
    p_fulfillment_type: input.fulfillmentType,
    p_payment_method: input.paymentMethod,
    p_items: input.items,
    p_idempotency_key: input.idempotencyKey,
    p_delivery_zip: input.delivery?.zip || null,
    p_delivery_street: input.delivery?.street || null,
    p_delivery_number: input.delivery?.number || null,
    p_delivery_complement: input.delivery?.complement || null,
    p_delivery_neighborhood: input.delivery?.neighborhood || null,
    p_delivery_city: input.delivery?.city || null,
    p_delivery_state: input.delivery?.state || null,
    p_delivery_reference: input.delivery?.reference || null,
    p_change_for: input.changeFor,
    p_observation: input.observation || null,
  });

  if (error) return { status: "error", message: friendlyOrderError(error.message) };

  const row = data?.[0];
  if (!row) {
    return { status: "error", message: "Não foi possível finalizar o pedido. Seus itens continuam na sacola. Tente novamente." };
  }

  return { status: "success", publicId: row.public_id, orderNumber: row.order_number };
}
