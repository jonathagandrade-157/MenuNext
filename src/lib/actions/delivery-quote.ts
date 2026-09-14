"use server";

import { createClient } from "@/lib/supabase/server";
import { getPublicRestaurantBySlug } from "@/lib/store";
import { buildGeocodableAddress, computeDeliveryQuote, haversineDistanceKm, needsRestaurantLocation } from "@/lib/delivery";
import { geocodeAddress } from "@/lib/geocoding";

export type DeliveryAddressInputForQuote = {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zip: string;
};

type DistanceResolution = { ok: true; distanceKm: number | null } | { ok: false; message: string };

/**
 * Resolve a distância (em km) entre o restaurante e o endereço do cliente,
 * SÓ quando isso realmente importa (raio máximo configurado OU método "por
 * km") — evita geocodificar (chamada externa) no caso comum de taxa fixa
 * sem raio, que continua funcionando exatamente como antes desta fase.
 * Usada tanto pelo preview do checkout (getDeliveryQuoteAction) quanto por
 * submitOrderAction, para nunca duplicar a decisão "preciso calcular
 * distância?" em dois lugares.
 */
async function resolveDeliveryDistanceKm(
  slug: string,
  address: DeliveryAddressInputForQuote
): Promise<DistanceResolution> {
  const supabase = await createClient();
  const restaurant = await getPublicRestaurantBySlug(supabase, slug);
  // Loja não encontrada/indisponível: deixa a RPC create_order recusar com
  // a mensagem de sempre, em vez de duplicar essa checagem aqui.
  if (!restaurant) return { ok: true, distanceKm: null };

  const needsDistance = needsRestaurantLocation({
    serviceDelivery: restaurant.service_delivery,
    method: restaurant.delivery_fee_method,
    radiusKm: restaurant.delivery_radius_km,
  });
  if (!needsDistance) return { ok: true, distanceKm: null };

  if (restaurant.latitude === null || restaurant.longitude === null) {
    return {
      ok: false,
      message: "Esta loja ainda não concluiu a configuração de localização para cálculo de frete. Tente novamente mais tarde.",
    };
  }

  const geocoded = await geocodeAddress(buildGeocodableAddress(address));
  if (!geocoded.ok) {
    return {
      ok: false,
      message: "Não foi possível calcular a distância de entrega para este endereço. Verifique os dados e tente novamente.",
    };
  }

  const distanceKm = haversineDistanceKm({ lat: restaurant.latitude, lng: restaurant.longitude }, geocoded.point);
  return { ok: true, distanceKm };
}

export type DeliveryQuoteActionResult =
  | { status: "success"; distanceKm: number | null; fee: number }
  | { status: "error"; message: string };

/**
 * Preview do frete no checkout, ANTES de criar o pedido — mesma resolução
 * de distância usada por submitOrderAction, mas aqui o resultado é só para
 * mostrar ao cliente (o valor final e autoritativo é sempre recalculado de
 * novo dentro de create_order).
 */
export async function getDeliveryQuoteAction(
  slug: string,
  address: DeliveryAddressInputForQuote
): Promise<DeliveryQuoteActionResult> {
  const supabase = await createClient();
  const restaurant = await getPublicRestaurantBySlug(supabase, slug);
  if (!restaurant) return { status: "error", message: "Esta loja não está disponível no momento." };

  const distanceResult = await resolveDeliveryDistanceKm(slug, address);
  if (!distanceResult.ok) return { status: "error", message: distanceResult.message };

  const quote = computeDeliveryQuote({
    method: restaurant.delivery_fee_method,
    rate: restaurant.delivery_fee ?? 0,
    distanceKm: distanceResult.distanceKm,
    radiusKm: restaurant.delivery_radius_km,
  });

  if (!quote.ok) {
    return {
      status: "error",
      message:
        quote.reason === "out_of_range"
          ? "Não entregamos neste endereço — está fora da área de entrega."
          : "Não foi possível calcular o frete para este endereço.",
    };
  }

  return { status: "success", distanceKm: quote.distanceKm, fee: quote.fee };
}

export type ResolvedDeliveryDistance = DistanceResolution;

/** Exportado para submitOrderAction reaproveitar a mesma resolução, sem
 * duplicar a decisão de quando geocodificar. */
export async function resolveDeliveryDistanceForOrder(
  slug: string,
  address: DeliveryAddressInputForQuote
): Promise<ResolvedDeliveryDistance> {
  return resolveDeliveryDistanceKm(slug, address);
}
