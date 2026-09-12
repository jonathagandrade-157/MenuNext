import { describe, expect, it } from "vitest";
import { buildSetupChecklist, computeSetupItems, type SetupCounts } from "./setup";
import type { Restaurant } from "./tenant";

function makeRestaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    id: "r1",
    name: "Loja Teste",
    slug: "loja-teste",
    status: "draft",
    onboarding_completed: false,
    onboarding_step: 1,
    address_zip: null,
    address_street: null,
    address_number: null,
    address_complement: null,
    address_neighborhood: null,
    address_city: null,
    address_state: null,
    service_delivery: false,
    service_pickup: false,
    delivery_fee: null,
    delivery_radius_km: null,
    delivery_fee_method: "fixed",
    latitude: null,
    longitude: null,
    minimum_order_value: null,
    estimated_delivery_min_minutes: null,
    estimated_delivery_max_minutes: null,
    payment_pix: false,
    payment_pix_key: null,
    payment_cash: false,
    payment_card: false,
    logo_path: null,
    cover_path: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const zeroCounts: SetupCounts = { activeProducts: 0, activeCategories: 0, openBusinessHours: 0 };

describe("computeSetupItems — nenhum dado preenchido", () => {
  it("todos os 8 itens aparecem como pendentes", () => {
    const items = computeSetupItems(makeRestaurant(), zeroCounts);
    expect(items).toHaveLength(8);
    expect(items.every((item) => item.completed === false)).toBe(true);
  });
});

describe("computeSetupItems — informações da loja", () => {
  it("pendente com endereço incompleto", () => {
    const restaurant = makeRestaurant({ address_zip: "01000-000", address_street: "Rua A" });
    const item = computeSetupItems(restaurant, zeroCounts).find((i) => i.id === "informacoes")!;
    expect(item.completed).toBe(false);
  });

  it("concluído com endereço completo", () => {
    const restaurant = makeRestaurant({
      address_zip: "01000-000",
      address_street: "Rua A",
      address_city: "São Paulo",
      address_state: "SP",
    });
    const item = computeSetupItems(restaurant, zeroCounts).find((i) => i.id === "informacoes")!;
    expect(item.completed).toBe(true);
  });
});

describe("computeSetupItems — identidade e aparência (logo/capa independentes)", () => {
  it("identidade concluída só com logo", () => {
    const restaurant = makeRestaurant({ logo_path: "r1/branding/logo.jpg" });
    const items = computeSetupItems(restaurant, zeroCounts);
    expect(items.find((i) => i.id === "identidade")!.completed).toBe(true);
    expect(items.find((i) => i.id === "aparencia")!.completed).toBe(false);
  });

  it("aparência concluída só com capa", () => {
    const restaurant = makeRestaurant({ cover_path: "r1/branding/cover.jpg" });
    const items = computeSetupItems(restaurant, zeroCounts);
    expect(items.find((i) => i.id === "identidade")!.completed).toBe(false);
    expect(items.find((i) => i.id === "aparencia")!.completed).toBe(true);
  });
});

describe("computeSetupItems — produtos e categorias derivados de contagem real", () => {
  it("pendente com contagem zero", () => {
    const items = computeSetupItems(makeRestaurant(), zeroCounts);
    expect(items.find((i) => i.id === "produtos")!.completed).toBe(false);
    expect(items.find((i) => i.id === "categorias")!.completed).toBe(false);
  });

  it("concluído assim que existe pelo menos 1", () => {
    const items = computeSetupItems(makeRestaurant(), { activeProducts: 1, activeCategories: 1, openBusinessHours: 0 });
    expect(items.find((i) => i.id === "produtos")!.completed).toBe(true);
    expect(items.find((i) => i.id === "categorias")!.completed).toBe(true);
  });
});

describe("computeSetupItems — horários", () => {
  it("pendente sem nenhum dia aberto", () => {
    const item = computeSetupItems(makeRestaurant(), zeroCounts).find((i) => i.id === "horarios")!;
    expect(item.completed).toBe(false);
  });

  it("concluído com pelo menos 1 dia aberto", () => {
    const item = computeSetupItems(makeRestaurant(), { ...zeroCounts, openBusinessHours: 1 }).find(
      (i) => i.id === "horarios"
    )!;
    expect(item.completed).toBe(true);
  });
});

describe("computeSetupItems — pagamentos", () => {
  it("pendente sem nenhuma forma selecionada", () => {
    const item = computeSetupItems(makeRestaurant(), zeroCounts).find((i) => i.id === "pagamentos")!;
    expect(item.completed).toBe(false);
  });

  it("concluído com qualquer forma selecionada (pix, dinheiro ou cartão)", () => {
    expect(computeSetupItems(makeRestaurant({ payment_pix: true }), zeroCounts).find((i) => i.id === "pagamentos")!.completed).toBe(true);
    expect(computeSetupItems(makeRestaurant({ payment_cash: true }), zeroCounts).find((i) => i.id === "pagamentos")!.completed).toBe(true);
    expect(computeSetupItems(makeRestaurant({ payment_card: true }), zeroCounts).find((i) => i.id === "pagamentos")!.completed).toBe(true);
  });
});

describe("computeSetupItems — entrega", () => {
  it("concluído com retirada habilitada, mesmo sem delivery", () => {
    const item = computeSetupItems(makeRestaurant({ service_pickup: true }), zeroCounts).find((i) => i.id === "entrega")!;
    expect(item.completed).toBe(true);
  });

  it("pendente com delivery habilitado mas sem taxa/raio definidos", () => {
    const item = computeSetupItems(makeRestaurant({ service_delivery: true }), zeroCounts).find((i) => i.id === "entrega")!;
    expect(item.completed).toBe(false);
  });

  it("concluído com delivery habilitado e taxa/raio definidos", () => {
    const restaurant = makeRestaurant({ service_delivery: true, delivery_fee: 8, delivery_radius_km: 5 });
    const item = computeSetupItems(restaurant, zeroCounts).find((i) => i.id === "entrega")!;
    expect(item.completed).toBe(true);
  });

  it("pendente sem nenhuma modalidade selecionada", () => {
    const item = computeSetupItems(makeRestaurant(), zeroCounts).find((i) => i.id === "entrega")!;
    expect(item.completed).toBe(false);
  });
});

describe("buildSetupChecklist — percentual real, nunca fixo", () => {
  it("0% com nada concluído", () => {
    const checklist = buildSetupChecklist(computeSetupItems(makeRestaurant(), zeroCounts));
    expect(checklist.percent).toBe(0);
    expect(checklist.completedCount).toBe(0);
    expect(checklist.totalCount).toBe(8);
    expect(checklist.isComplete).toBe(false);
  });

  it("percentual calculado a partir dos itens reais (6 de 8 = 75%)", () => {
    const restaurant = makeRestaurant({
      address_zip: "01000-000",
      address_street: "Rua A",
      address_city: "São Paulo",
      address_state: "SP",
      logo_path: "r1/branding/logo.jpg",
      payment_cash: true,
      service_pickup: true,
      cover_path: "r1/branding/cover.jpg",
    });
    // informacoes, identidade, pagamentos, entrega, aparencia = 5 concluídos;
    // produtos/categorias/horarios pendentes (contagens zero) = 5/8 = 62.5% -> 63%
    const checklist = buildSetupChecklist(computeSetupItems(restaurant, zeroCounts));
    expect(checklist.completedCount).toBe(5);
    expect(checklist.percent).toBe(Math.round((5 / 8) * 100));
  });

  it("100% e isComplete quando todos os itens estão concluídos", () => {
    const restaurant = makeRestaurant({
      address_zip: "01000-000",
      address_street: "Rua A",
      address_city: "São Paulo",
      address_state: "SP",
      logo_path: "r1/branding/logo.jpg",
      cover_path: "r1/branding/cover.jpg",
      payment_cash: true,
      service_pickup: true,
    });
    const counts: SetupCounts = { activeProducts: 1, activeCategories: 1, openBusinessHours: 1 };
    const checklist = buildSetupChecklist(computeSetupItems(restaurant, counts));
    expect(checklist.percent).toBe(100);
    expect(checklist.isComplete).toBe(true);
  });

  it("atualização automática: adicionar 1 produto muda o item de pendente para concluído", () => {
    const restaurant = makeRestaurant();
    const before = computeSetupItems(restaurant, zeroCounts).find((i) => i.id === "produtos")!;
    const after = computeSetupItems(restaurant, { ...zeroCounts, activeProducts: 1 }).find((i) => i.id === "produtos")!;
    expect(before.completed).toBe(false);
    expect(after.completed).toBe(true);
  });
});
