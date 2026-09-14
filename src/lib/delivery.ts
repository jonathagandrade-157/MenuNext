/**
 * Regras puras de frete por distância (Fase 4.1.1) — compartilhadas pelo
 * preview do checkout (getDeliveryQuoteAction) e usadas como espelho da
 * lógica equivalente em SQL (create_order, migration
 * add_distance_based_delivery_fee.sql). A RPC é sempre a fonte de verdade
 * final (nunca confia em nada calculado aqui); este módulo existe para não
 * duplicar a fórmula sem testes e para o preview do checkout responder sem
 * precisar criar o pedido.
 */

export type DeliveryFeeMethod = "fixed" | "per_km";

export type GeoPoint = { lat: number; lng: number };

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Distância em linha reta (grande círculo) entre dois pontos, em km. Não é
 * a distância real de rota — é a estimativa mais simples e confiável
 * possível sem depender de um serviço de rotas (fora do escopo desta fase:
 * "o objetivo é SOMENTE calcular a distância para determinar o frete"). */
export function haversineDistanceKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  return EARTH_RADIUS_KM * c;
}

/** Arredondamento monetário consistente (2 casas, meio para cima) — nunca
 * comparar/gravar dinheiro com float bruto. Mesma regra usada pela coluna
 * numeric(10,2) do Postgres (round() padrão SQL), para o valor mostrado no
 * preview do checkout nunca divergir do gravado pela RPC. */
export function roundToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type DeliveryQuoteInput = {
  method: DeliveryFeeMethod;
  /** Taxa fixa (método "fixed") ou valor por km (método "per_km"). */
  rate: number;
  /** Distância até o cliente — null quando não há necessidade de calculá-la
   * (método fixo sem raio máximo configurado). */
  distanceKm: number | null;
  /** null = sem limite de raio configurado. */
  radiusKm: number | null;
};

export type DeliveryQuoteResult =
  | { ok: true; fee: number; distanceKm: number | null }
  | { ok: false; reason: "out_of_range" | "distance_required" };

/**
 * Determina o frete final a partir da config do restaurante + distância já
 * calculada (o cálculo da distância em si — geocoding — não é
 * responsabilidade deste módulo, ver src/lib/geocoding.ts). Espelha
 * exatamente a validação feita dentro de create_order.
 */
export function computeDeliveryQuote(input: DeliveryQuoteInput): DeliveryQuoteResult {
  const { method, rate, distanceKm, radiusKm } = input;

  if (radiusKm !== null) {
    if (distanceKm === null) return { ok: false, reason: "distance_required" };
    if (distanceKm > radiusKm) return { ok: false, reason: "out_of_range" };
  }

  if (method === "per_km") {
    if (distanceKm === null) return { ok: false, reason: "distance_required" };
    return { ok: true, fee: roundToCents(rate * distanceKm), distanceKm };
  }

  return { ok: true, fee: roundToCents(rate), distanceKm };
}

export type DeliveryLocationInput = {
  serviceDelivery: boolean;
  method: DeliveryFeeMethod;
  radiusKm: number | null;
};

/**
 * Única fonte de verdade para "esta configuração de delivery precisa da
 * localização (lat/lng) do restaurante" — usada tanto para decidir quando
 * geocodificar o endereço ao salvar (/painel/delivery, saveDeliveryConfigAction)
 * quanto para decidir quando calcular distância no checkout
 * (resolveDeliveryDistanceKm). As duas decisões nunca podem divergir: se o
 * checkout vai precisar de distância, o salvamento já precisa ter
 * geocodificado antes — raio máximo (delivery_radius_km) exige a distância
 * até o cliente para validar o limite em QUALQUER método de cobrança, não
 * só "per_km".
 */
export function needsRestaurantLocation({ serviceDelivery, method, radiusKm }: DeliveryLocationInput): boolean {
  if (!serviceDelivery) return false;
  return radiusKm !== null || method === "per_km";
}

export function buildGeocodableAddress(parts: {
  street: string;
  number: string;
  neighborhood?: string | null;
  city: string;
  state?: string | null;
  zip?: string | null;
}): string {
  return [
    `${parts.street}, ${parts.number}`,
    parts.neighborhood,
    parts.city,
    parts.state,
    parts.zip,
    "Brasil",
  ]
    .filter((part) => part && part.trim())
    .join(", ");
}
