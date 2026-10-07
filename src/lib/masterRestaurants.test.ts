import { describe, expect, it } from "vitest";
import {
  buildActivationSteps,
  buildListHref,
  computeActivationProgress,
  computeCompletionRate,
  computeMrr,
  parseListParams,
  type MasterRestaurantDetail,
} from "./masterRestaurants";

function makeDetail(overrides: Partial<MasterRestaurantDetail> = {}): MasterRestaurantDetail {
  return {
    id: "r1",
    name: "Loja Teste",
    slug: "loja-teste",
    status: "draft",
    onboarding_completed: false,
    onboarding_step: 3,
    created_at: "2026-09-10T23:01:52Z",
    contact_whatsapp: null,
    contact_email: null,
    plan_name: null,
    plan_price: null,
    subscription_status: "active",
    owner_name: null,
    owner_email: null,
    orders_total: 0,
    orders_today: 0,
    orders_month: 0,
    orders_completed: 0,
    orders_cancelled: 0,
    customers_unique: 0,
    first_order_at: null,
    last_order_at: null,
    products_count: 0,
    open_business_days: 0,
    ...overrides,
  };
}

describe("parseListParams — a query string nunca é confiável", () => {
  it("sem parâmetros: sem busca, sem filtro, página 1", () => {
    expect(parseListParams({})).toEqual({ search: null, subscriptionStatus: null, page: 1 });
  });

  it("apara a busca e ignora busca vazia", () => {
    expect(parseListParams({ q: "  burger  " }).search).toBe("burger");
    expect(parseListParams({ q: "   " }).search).toBeNull();
  });

  it("limita a busca a 80 caracteres", () => {
    expect(parseListParams({ q: "a".repeat(200) }).search).toHaveLength(80);
  });

  it("aceita só status de assinatura conhecidos", () => {
    expect(parseListParams({ status: "overdue" }).subscriptionStatus).toBe("overdue");
    expect(parseListParams({ status: "hacked" }).subscriptionStatus).toBeNull();
    expect(parseListParams({ status: "" }).subscriptionStatus).toBeNull();
  });

  it("página inválida, zero ou negativa vira 1", () => {
    for (const page of ["abc", "0", "-3", ""]) {
      expect(parseListParams({ page }).page).toBe(1);
    }
    expect(parseListParams({ page: "4" }).page).toBe(4);
  });

  it("valor repetido na query usa o primeiro", () => {
    expect(parseListParams({ q: ["a", "b"] }).search).toBe("a");
  });
});

describe("buildListHref", () => {
  it("sem filtros devolve a rota limpa", () => {
    expect(buildListHref({ search: null, subscriptionStatus: null, page: 1 })).toBe("/master/restaurantes");
  });

  it("codifica a busca e omite a página 1", () => {
    expect(buildListHref({ search: "café & cia", subscriptionStatus: "overdue", page: 1 })).toBe(
      "/master/restaurantes?q=caf%C3%A9+%26+cia&status=overdue"
    );
  });

  it("inclui a página a partir da 2", () => {
    expect(buildListHref({ search: null, subscriptionStatus: null, page: 3 })).toBe("/master/restaurantes?page=3");
  });
});

describe("computeMrr", () => {
  it("só conta o valor do plano com assinatura em dia", () => {
    expect(computeMrr(99.9, "active")).toBe(99.9);
    expect(computeMrr(99.9, "pending")).toBe(0);
    expect(computeMrr(99.9, "overdue")).toBe(0);
    expect(computeMrr(99.9, "cancelled")).toBe(0);
  });

  it("sem plano não há receita, mesmo 'em dia'", () => {
    expect(computeMrr(null, "active")).toBe(0);
  });
});

describe("computeCompletionRate", () => {
  it("sem pedidos encerrados não há taxa (null, nunca 0% ou 100%)", () => {
    expect(computeCompletionRate(0, 0)).toBeNull();
  });

  it("calcula sobre concluídos + cancelados, com uma casa decimal", () => {
    expect(computeCompletionRate(241, 9)).toBe(96.4);
    expect(computeCompletionRate(1, 2)).toBe(33.3);
  });

  it("todos concluídos = 100, todos cancelados = 0", () => {
    expect(computeCompletionRate(10, 0)).toBe(100);
    expect(computeCompletionRate(0, 4)).toBe(0);
  });
});

describe("buildActivationSteps — só fatos reais", () => {
  it("restaurante recém-criado: só 'conta criada' está feita", () => {
    const steps = buildActivationSteps(makeDetail());
    expect(steps.filter((s) => s.done).map((s) => s.id)).toEqual(["account"]);
    expect(computeActivationProgress(steps)).toEqual({ done: 1, total: 6, percent: 17 });
  });

  it("mostra em que passo do onboarding o lojista parou", () => {
    const onboarding = buildActivationSteps(makeDetail({ onboarding_step: 4 })).find((s) => s.id === "onboarding")!;
    expect(onboarding.done).toBe(false);
    expect(onboarding.label).toContain("passo 4 de 7");
  });

  it("loja publicada exige onboarding concluído E status ativo", () => {
    const publishedOf = (overrides: Partial<MasterRestaurantDetail>) =>
      buildActivationSteps(makeDetail(overrides)).find((s) => s.id === "published")!.done;
    expect(publishedOf({ onboarding_completed: true, status: "active" })).toBe(true);
    expect(publishedOf({ onboarding_completed: true, status: "paused" })).toBe(false);
    expect(publishedOf({ onboarding_completed: false, status: "active" })).toBe(false);
  });

  it("cardápio, horários e primeiro pedido vêm das contagens reais", () => {
    const steps = buildActivationSteps(
      makeDetail({ products_count: 3, open_business_days: 5, first_order_at: "2026-09-20T12:00:00Z" })
    );
    const done = (id: string) => steps.find((s) => s.id === id)!.done;
    expect(done("menu")).toBe(true);
    expect(done("hours")).toBe(true);
    expect(done("first_order")).toBe(true);
    expect(steps.find((s) => s.id === "first_order")!.date).toBe("2026-09-20T12:00:00Z");
  });

  it("tudo concluído = 100%", () => {
    const steps = buildActivationSteps(
      makeDetail({
        status: "active",
        onboarding_completed: true,
        products_count: 1,
        open_business_days: 1,
        first_order_at: "2026-09-20T12:00:00Z",
      })
    );
    expect(computeActivationProgress(steps).percent).toBe(100);
  });
});
