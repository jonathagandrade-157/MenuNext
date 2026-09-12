import { describe, expect, it } from "vitest";
import { buildGeocodableAddress, computeDeliveryQuote, haversineDistanceKm, roundToCents } from "./delivery";

describe("roundToCents", () => {
  it("arredonda para 2 casas decimais", () => {
    expect(roundToCents(10.575)).toBe(10.58);
    expect(roundToCents(4.23 * 2.5)).toBe(10.58);
    expect(roundToCents(5)).toBe(5);
  });
});

describe("haversineDistanceKm", () => {
  it("retorna 0 para o mesmo ponto", () => {
    expect(haversineDistanceKm({ lat: -23.5505, lng: -46.6333 }, { lat: -23.5505, lng: -46.6333 })).toBe(0);
  });

  it("calcula uma distância aproximada e simétrica entre dois pontos conhecidos", () => {
    // São Paulo (Praça da Sé) -> Rio de Janeiro (Cristo Redentor), ~360km em linha reta.
    const sp = { lat: -23.5505, lng: -46.6333 };
    const rj = { lat: -22.9519, lng: -43.2105 };
    const distance = haversineDistanceKm(sp, rj);
    expect(distance).toBeGreaterThan(340);
    expect(distance).toBeLessThan(370);
    expect(haversineDistanceKm(rj, sp)).toBeCloseTo(distance, 5);
  });
});

describe("computeDeliveryQuote", () => {
  it("taxa fixa dentro do raio: retorna a taxa configurada, ignora distância", () => {
    const result = computeDeliveryQuote({ method: "fixed", rate: 8, distanceKm: 3, radiusKm: 10 });
    expect(result).toEqual({ ok: true, fee: 8, distanceKm: 3 });
  });

  it("taxa fixa sem raio configurado: não exige distância", () => {
    const result = computeDeliveryQuote({ method: "fixed", rate: 8, distanceKm: null, radiusKm: null });
    expect(result).toEqual({ ok: true, fee: 8, distanceKm: null });
  });

  it("por km: calcula rate * distancia com arredondamento monetário", () => {
    expect(computeDeliveryQuote({ method: "per_km", rate: 2.5, distanceKm: 2, radiusKm: 10 })).toEqual({
      ok: true,
      fee: 5,
      distanceKm: 2,
    });
    expect(computeDeliveryQuote({ method: "per_km", rate: 2.5, distanceKm: 4, radiusKm: 10 })).toEqual({
      ok: true,
      fee: 10,
      distanceKm: 4,
    });
    expect(computeDeliveryQuote({ method: "per_km", rate: 2.5, distanceKm: 5.5, radiusKm: 10 })).toEqual({
      ok: true,
      fee: 13.75,
      distanceKm: 5.5,
    });
    expect(computeDeliveryQuote({ method: "per_km", rate: 2.5, distanceKm: 10, radiusKm: 10 })).toEqual({
      ok: true,
      fee: 25,
      distanceKm: 10,
    });
  });

  it("por km exige distância conhecida", () => {
    expect(computeDeliveryQuote({ method: "per_km", rate: 2.5, distanceKm: null, radiusKm: 10 })).toEqual({
      ok: false,
      reason: "distance_required",
    });
  });

  it("bloqueia quando a distância excede o raio máximo, em qualquer método", () => {
    expect(computeDeliveryQuote({ method: "fixed", rate: 8, distanceKm: 10.01, radiusKm: 10 })).toEqual({
      ok: false,
      reason: "out_of_range",
    });
    expect(computeDeliveryQuote({ method: "per_km", rate: 2.5, distanceKm: 10.01, radiusKm: 10 })).toEqual({
      ok: false,
      reason: "out_of_range",
    });
  });

  it("distância exatamente igual ao raio é permitida (limite inclusivo)", () => {
    expect(computeDeliveryQuote({ method: "fixed", rate: 8, distanceKm: 10, radiusKm: 10 }).ok).toBe(true);
  });
});

describe("buildGeocodableAddress", () => {
  it("junta as partes preenchidas, ignorando vazias/nulas", () => {
    const address = buildGeocodableAddress({
      street: "Rua Teste",
      number: "100",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
      zip: "01000-000",
    });
    expect(address).toBe("Rua Teste, 100, Centro, São Paulo, SP, 01000-000, Brasil");
  });

  it("omite complemento/estado/cep ausentes sem deixar vírgulas soltas", () => {
    const address = buildGeocodableAddress({ street: "Rua Teste", number: "100", city: "São Paulo" });
    expect(address).toBe("Rua Teste, 100, São Paulo, Brasil");
  });
});
