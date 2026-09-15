"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMyRestaurant, type Restaurant } from "@/lib/tenant";
import { buildGeocodableAddress, needsRestaurantLocation, type DeliveryFeeMethod } from "@/lib/delivery";
import { geocodeAddress, isGeocodingConfigured } from "@/lib/geocoding";
import type { DeliveryConfigActionState } from "@/lib/form-state";

const DELIVERY_PATH = "/painel/delivery";

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

/** Retorna null para vazio, NaN para "preenchido mas inválido" — para os dois
 * casos serem distinguíveis na validação abaixo. */
function parseOptionalDecimal(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : NaN;
}

/**
 * Configuração consolidada de delivery (Fase 4.1) — reaproveita
 * service_delivery/service_pickup/delivery_fee/delivery_radius_km (já
 * existiam desde o onboarding, Passo 3/4) e adiciona pedido mínimo + tempo
 * estimado de entrega, os dois únicos campos realmente novos daquela fase.
 * service_pickup foi incluído aqui (fase de separação onboarding/painel) só
 * como o mesmo toggle de compatibilidade que já existia no Passo 3 — a
 * retirada continua fora da experiência do cliente, isto só evita que o
 * campo só seja editável dentro do onboarding. Horários continuam vivendo
 * só em business_hours (/painel/horarios) — não duplicados aqui, apenas
 * linkados. Ligar/desligar o delivery aqui nunca apaga taxa/raio/pedido
 * mínimo já configurados: o lojista pode desativar temporariamente sem
 * perder a configuração.
 */
export async function saveDeliveryConfigAction(
  _prev: DeliveryConfigActionState,
  formData: FormData
): Promise<DeliveryConfigActionState> {
  const { supabase, restaurant } = await requireRestaurant();

  const serviceDelivery = formData.get("service_delivery") === "on";
  const servicePickup = formData.get("service_pickup") === "on";
  const feeMethodRaw = String(formData.get("delivery_fee_method") ?? "fixed");
  const feeMethod: DeliveryFeeMethod = feeMethodRaw === "per_km" ? "per_km" : "fixed";
  const feeRaw = String(formData.get("delivery_fee") ?? "");
  const radiusRaw = String(formData.get("delivery_radius_km") ?? "");
  const minOrderRaw = String(formData.get("minimum_order_value") ?? "");
  const estMinRaw = String(formData.get("estimated_delivery_min_minutes") ?? "").trim();
  const estMaxRaw = String(formData.get("estimated_delivery_max_minutes") ?? "").trim();

  const fee = parseOptionalDecimal(feeRaw);
  const radius = parseOptionalDecimal(radiusRaw);
  const minOrder = parseOptionalDecimal(minOrderRaw);
  const estMin = estMinRaw === "" ? null : Number(estMinRaw);
  const estMax = estMaxRaw === "" ? null : Number(estMaxRaw);

  if (serviceDelivery) {
    if (fee === null || Number.isNaN(fee) || fee < 0) {
      return {
        status: "error",
        message: feeMethod === "per_km" ? "Informe um valor por km válido." : "Informe uma taxa de entrega válida.",
      };
    }
    if (radius === null || Number.isNaN(radius) || radius <= 0) {
      return { status: "error", message: "Informe um raio de entrega válido." };
    }
  } else {
    if (Number.isNaN(fee) || Number.isNaN(radius)) {
      return { status: "error", message: "Verifique a taxa e o raio de entrega informados." };
    }
  }

  if (Number.isNaN(minOrder) || (minOrder !== null && minOrder < 0)) {
    return { status: "error", message: "Informe um pedido mínimo válido." };
  }

  if ((estMin === null) !== (estMax === null)) {
    return { status: "error", message: "Informe o tempo estimado mínimo e máximo, ou deixe os dois em branco." };
  }
  if (estMin !== null && estMax !== null) {
    if (!Number.isInteger(estMin) || !Number.isInteger(estMax) || estMin < 0 || estMax < 0) {
      return { status: "error", message: "O tempo estimado de entrega deve ser em minutos inteiros." };
    }
    if (estMax < estMin) {
      return { status: "error", message: "O tempo máximo estimado deve ser maior ou igual ao mínimo." };
    }
  }

  // O checkout precisa da localização do PRÓPRIO restaurante sempre que o
  // raio máximo (delivery_radius_km, obrigatório com delivery ativo) ou o
  // método "por km" exigirem calcular a distância até o cliente — em
  // QUALQUER método de cobrança, não só "per_km" (mesma decisão usada em
  // resolveDeliveryDistanceKm, ver needsRestaurantLocation em
  // src/lib/delivery.ts, para as duas nunca divergirem). Geocodificada aqui
  // (servidor), uma vez por salvamento, nunca no navegador. Fora do escopo:
  // geocodificar a cada pedido o endereço do restaurante, que já é
  // conhecido e estável.
  let latitude: number | null = null;
  let longitude: number | null = null;
  if (needsRestaurantLocation({ serviceDelivery, method: feeMethod, radiusKm: radius })) {
    if (!isGeocodingConfigured()) {
      return {
        status: "error",
        message:
          "Não foi possível ativar o delivery: falta configurar a variável de ambiente GOOGLE_MAPS_GEOCODING_API_KEY no servidor para calcular a área de entrega.",
      };
    }
    if (!restaurant.address_street || !restaurant.address_number || !restaurant.address_city) {
      return {
        status: "error",
        message: "Cadastre o endereço completo do restaurante (Passo 2) antes de ativar o delivery.",
      };
    }
    const restaurantAddress = buildGeocodableAddress({
      street: restaurant.address_street,
      number: restaurant.address_number,
      neighborhood: restaurant.address_neighborhood,
      city: restaurant.address_city,
      state: restaurant.address_state,
      zip: restaurant.address_zip,
    });
    const geocoded = await geocodeAddress(restaurantAddress);
    if (!geocoded.ok) {
      return {
        status: "error",
        message: "Não foi possível localizar o endereço do restaurante. Verifique o endereço cadastrado e tente novamente.",
      };
    }
    latitude = geocoded.point.lat;
    longitude = geocoded.point.lng;
  }

  const update: Record<string, unknown> = {
    service_delivery: serviceDelivery,
    service_pickup: servicePickup,
    delivery_fee: fee,
    delivery_radius_km: radius,
    delivery_fee_method: feeMethod,
    minimum_order_value: minOrder,
    estimated_delivery_min_minutes: estMin,
    estimated_delivery_max_minutes: estMax,
  };
  if (needsRestaurantLocation({ serviceDelivery, method: feeMethod, radiusKm: radius })) {
    update.latitude = latitude;
    update.longitude = longitude;
  }

  const { error } = await supabase.from("restaurants").update(update).eq("id", restaurant.id);
  if (error) return { status: "error", message: "Não foi possível salvar. Tente novamente." };

  revalidatePath(DELIVERY_PATH);
  revalidatePath("/painel");
  return { status: "success" };
}
