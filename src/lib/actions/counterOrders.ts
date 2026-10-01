"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyRestaurant } from "@/lib/tenant";
import { getPublicProductDetail, type PublicProductDetail } from "@/lib/store";
import { getPublicAssetUrl } from "@/lib/storage/assets";
import { friendlyOrderError } from "@/lib/orderErrors";
import type { CreateOrderItemPayload } from "@/lib/checkout";

export type CounterOrderInput = {
  customerName: string;
  customerPhone: string;
  paymentMethod: "pix" | "cash" | "card";
  changeFor: number | null;
  observation: string;
  items: CreateOrderItemPayload[];
  idempotencyKey: string;
  couponCode: string | null;
};

export type CounterOrderResult =
  | { status: "success"; publicId: string; orderNumber: number }
  | { status: "error"; message: string };

/**
 * Venda de balcão (Frente de Caixa) — diferente de submitOrderAction
 * (guest checkout, sempre anônimo), aqui quem cria o pedido é um membro
 * AUTENTICADO do restaurante. Mesma RPC create_order (agora com
 * fulfillment_type='counter'), que exige auth.uid() + membership dentro
 * dela mesma (ver migration add_counter_orders.sql) — nunca confia só na
 * sessão aqui fora, a checagem real é sempre no servidor/banco.
 */
export async function createCounterOrderAction(input: CounterOrderInput): Promise<CounterOrderResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const { data, error } = await supabase.rpc("create_order", {
    p_slug: restaurant.slug,
    p_customer_name: input.customerName,
    p_customer_phone: input.customerPhone,
    p_fulfillment_type: "counter",
    p_payment_method: input.paymentMethod,
    p_items: input.items,
    p_idempotency_key: input.idempotencyKey,
    p_change_for: input.changeFor,
    p_observation: input.observation || null,
    p_coupon_code: input.couponCode,
  });

  if (error) return { status: "error", message: friendlyOrderError(error.message) };

  const row = data?.[0];
  if (!row) return { status: "error", message: "Não foi possível finalizar a venda. Tente novamente." };

  revalidatePath("/painel/pedidos");
  revalidatePath("/painel/caixa");
  revalidatePath("/painel");
  return { status: "success", publicId: row.public_id, orderNumber: row.order_number };
}

export type CounterProductDetailResult = { ok: true; product: PublicProductDetail } | { ok: false; error: string };

/**
 * Detalhe de UM produto (preço + grupos de adicionais) para o modal de
 * "adicionar item" do PDV — reaproveita getPublicProductDetail (mesma
 * função usada pela página pública do produto), mas deriva o restaurante
 * do membro autenticado (getMyRestaurant), nunca de um restaurantId vindo
 * do cliente.
 */
export async function getCounterProductDetailAction(productId: string): Promise<CounterProductDetailResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const getImageUrl = (path: string) => getPublicAssetUrl(supabase, path);
  const product = await getPublicProductDetail(supabase, restaurant.id, productId, getImageUrl);
  if (!product) return { ok: false, error: "Produto não encontrado." };

  return { ok: true, product };
}

export type ValidateCounterCouponResult =
  | { status: "success"; code: string; discountAmount: number }
  | { status: "error"; message: string };

function friendlyCouponValidationError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("coupon_not_found")) return "Cupom não encontrado.";
  if (normalized.includes("coupon_inactive")) return "Este cupom não está mais ativo.";
  if (normalized.includes("coupon_expired")) return "Este cupom expirou.";
  if (normalized.includes("coupon_usage_limit_reached")) return "Este cupom atingiu o limite de usos.";
  if (normalized.includes("coupon_below_minimum_order")) return "O valor da venda ainda não atinge o mínimo exigido por este cupom.";
  return "Não foi possível validar o cupom agora. Tente novamente.";
}

/** Mesma RPC validate_coupon do checkout público, mas derivando o
 * restaurante do caixa autenticado (getMyRestaurant) em vez de receber um
 * slug do cliente — o PDV não precisa saber o slug da própria loja. */
export async function validateCounterCouponAction(code: string, subtotal: number): Promise<ValidateCounterCouponResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const { data, error } = await supabase.rpc("validate_coupon", { p_slug: restaurant.slug, p_code: code, p_subtotal: subtotal });
  if (error) return { status: "error", message: friendlyCouponValidationError(error.message) };

  const row = data?.[0];
  if (!row) return { status: "error", message: "Cupom não encontrado." };

  return { status: "success", code: row.code, discountAmount: Number(row.discount_amount) };
}
