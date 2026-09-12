/**
 * Geocoding server-side (Fase 4.1.1) — converte um endereço em texto para
 * latitude/longitude, único jeito viável de calcular distância sem "criar
 * um aplicativo de mapas": Postgres não tem acesso à rede para geocodificar
 * sozinho, então essa etapa acontece aqui (Server Action/Next.js), nunca no
 * navegador do cliente. A chave (`GOOGLE_MAPS_GEOCODING_API_KEY`) nunca tem
 * prefixo NEXT_PUBLIC_, então o bundler do Next.js nunca a inclui no
 * JavaScript enviado ao navegador — só código rodando no servidor lê
 * `process.env.GOOGLE_MAPS_GEOCODING_API_KEY`.
 *
 * Se a variável não estiver configurada, geocodeAddress nunca inventa uma
 * chave nem finge sucesso — retorna `{ ok: false, reason: "not_configured" }`
 * e quem chamar decide o que fazer (ex.: bloquear a ativação do método "por
 * km" em /painel/delivery com uma mensagem clara).
 */

import type { GeoPoint } from "@/lib/delivery";

export type GeocodeResult =
  | { ok: true; point: GeoPoint }
  | { ok: false; reason: "not_configured" | "not_found" | "request_failed" };

export function isGeocodingConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_GEOCODING_API_KEY);
}

export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const apiKey = process.env.GOOGLE_MAPS_GEOCODING_API_KEY;
  if (!apiKey) return { ok: false, reason: "not_configured" };

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("region", "br");
  url.searchParams.set("key", apiKey);

  let response: Response;
  try {
    response = await fetch(url.toString());
  } catch {
    return { ok: false, reason: "request_failed" };
  }

  if (!response.ok) return { ok: false, reason: "request_failed" };

  const body = (await response.json()) as {
    status: string;
    results?: { geometry?: { location?: { lat: number; lng: number } } }[];
  };

  if (body.status !== "OK") return { ok: false, reason: "not_found" };

  const location = body.results?.[0]?.geometry?.location;
  if (!location) return { ok: false, reason: "not_found" };

  return { ok: true, point: { lat: location.lat, lng: location.lng } };
}
