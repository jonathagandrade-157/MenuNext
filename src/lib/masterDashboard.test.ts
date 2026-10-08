import { describe, expect, it } from "vitest";
import {
  buildFunnelSteps,
  buildGrowthChart,
  computeAverageTicket,
  computeMrrBreakdown,
  formatMonthLabel,
  type PlanStat,
} from "./masterDashboard";

const plan = (overrides: Partial<PlanStat>): PlanStat => ({
  plan_id: "p",
  name: "Plano",
  price: 100,
  is_active: true,
  subscribers: 0,
  ...overrides,
});

describe("computeAverageTicket", () => {
  it("sem assinantes não há ticket médio (null, nunca 0)", () => {
    expect(computeAverageTicket(0, 0)).toBeNull();
  });

  it("divide a receita pelos assinantes em dia", () => {
    expect(computeAverageTicket(300, 4)).toBe(75);
  });
});

describe("computeMrrBreakdown", () => {
  it("sem assinantes, o total é 0 e a participação é null (nunca 0% inventado)", () => {
    const { rows, total } = computeMrrBreakdown([plan({ name: "Start", price: 50 })]);
    expect(total).toBe(0);
    expect(rows[0].share).toBeNull();
  });

  it("receita = preço x assinantes, e a participação soma 100%", () => {
    const { rows, total } = computeMrrBreakdown([
      plan({ plan_id: "a", name: "Start", price: 50, subscribers: 2 }),
      plan({ plan_id: "b", name: "Pro", price: 100, subscribers: 3 }),
    ]);
    expect(total).toBe(400);
    expect(rows.map((r) => r.revenue)).toEqual([100, 300]);
    expect(rows.map((r) => r.share)).toEqual([25, 75]);
  });

  it("plano desativado sem assinantes não aparece; com assinantes continua", () => {
    const { rows } = computeMrrBreakdown([
      plan({ plan_id: "old", name: "Legado", is_active: false, subscribers: 0 }),
      plan({ plan_id: "old2", name: "Antigo", is_active: false, subscribers: 2, price: 10 }),
      plan({ plan_id: "new", name: "Novo", is_active: true, subscribers: 0 }),
    ]);
    expect(rows.map((r) => r.plan_id)).toEqual(["old2", "new"]);
  });

  it("sem planos nenhum, lista vazia", () => {
    expect(computeMrrBreakdown([])).toEqual({ rows: [], total: 0 });
  });
});

describe("buildFunnelSteps", () => {
  it("cada etapa é % dos cadastrados", () => {
    const steps = buildFunnelSteps({ registered: 10, onboarding_done: 8, with_products: 5, published: 4, with_orders: 1 });
    expect(steps.map((s) => s.percent)).toEqual([100, 80, 50, 40, 10]);
    expect(steps.map((s) => s.count)).toEqual([10, 8, 5, 4, 1]);
  });

  it("sem cadastros nenhum, percentuais são null (nunca 0%)", () => {
    const steps = buildFunnelSteps({ registered: 0, onboarding_done: 0, with_products: 0, published: 0, with_orders: 0 });
    expect(steps.every((s) => s.percent === null)).toBe(true);
  });
});

describe("formatMonthLabel", () => {
  it("formata ano-mês em português", () => {
    expect(formatMonthLabel("2026-09")).toBe("set/26");
    expect(formatMonthLabel("2026-01")).toBe("jan/26");
    expect(formatMonthLabel("2025-12")).toBe("dez/25");
  });

  it("formato inesperado volta como veio", () => {
    expect(formatMonthLabel("setembro")).toBe("setembro");
    expect(formatMonthLabel("2026-13")).toBe("2026-13");
  });
});

describe("buildGrowthChart", () => {
  const size = { width: 100, height: 50, padX: 10, padY: 5 };

  it("série vazia não gera caminho", () => {
    expect(buildGrowthChart([], size)).toEqual({ line: "", area: "", dots: [], max: 0 });
  });

  it("série toda zerada vira uma linha reta na base (sem divisão por zero)", () => {
    const chart = buildGrowthChart(
      [
        { month: "2026-08", total: 0 },
        { month: "2026-09", total: 0 },
      ],
      size
    );
    expect(chart.max).toBe(0);
    expect(chart.dots.every((d) => d.y === 45)).toBe(true);
    expect(Number.isFinite(chart.dots[0].x)).toBe(true);
  });

  it("o maior valor encosta no topo e o menor na base", () => {
    const chart = buildGrowthChart(
      [
        { month: "2026-08", total: 0 },
        { month: "2026-09", total: 10 },
      ],
      size
    );
    expect(chart.dots[0]).toMatchObject({ x: 10, y: 45, value: 0 });
    expect(chart.dots[1]).toMatchObject({ x: 90, y: 5, value: 10 });
    expect(chart.line).toBe("M10,45 L90,5");
  });

  it("a área fecha o caminho pela base", () => {
    const chart = buildGrowthChart(
      [
        { month: "2026-08", total: 1 },
        { month: "2026-09", total: 2 },
      ],
      size
    );
    expect(chart.area.endsWith("Z")).toBe(true);
    expect(chart.area).toContain("L90,45 L10,45");
  });

  it("aceita uma função de rótulo própria (ex.: dias em vez de meses)", () => {
    const chart = buildGrowthChart(
      [
        { month: "2026-10-07", total: 1 },
        { month: "2026-10-08", total: 2 },
      ],
      size,
      (key) => `dia ${key.slice(-2)}`
    );
    expect(chart.dots.map((d) => d.label)).toEqual(["dia 07", "dia 08"]);
  });

  it("um único ponto fica centralizado", () => {
    const chart = buildGrowthChart([{ month: "2026-09", total: 3 }], size);
    expect(chart.dots[0].x).toBe(50);
  });
});
