import { describe, expect, it } from "vitest";
import {
  computeChurnRate,
  computeTicket,
  computeTrialConversion,
  computeVariation,
  formatDayLabel,
  ordersSeries,
  parsePeriod,
  percentOf,
} from "./masterMetrics";

describe("parsePeriod — o período da URL nunca é confiável", () => {
  it("aceita só 7, 30 e 90", () => {
    expect(parsePeriod("7")).toBe(7);
    expect(parsePeriod("30")).toBe(30);
    expect(parsePeriod("90")).toBe(90);
  });

  it("qualquer outra coisa vira 30", () => {
    for (const raw of [undefined, "", "5", "365", "-7", "abc"]) {
      expect(parsePeriod(raw)).toBe(30);
    }
  });

  it("valor repetido na URL usa o primeiro", () => {
    expect(parsePeriod(["90", "7"])).toBe(90);
  });
});

describe("percentOf / computeVariation — sem base não há percentual", () => {
  it("percentOf devolve null (nunca 0% ou 100%) quando não há base", () => {
    expect(percentOf(0, 0)).toBeNull();
    expect(percentOf(3, 0)).toBeNull();
    expect(percentOf(1, 4)).toBe(25);
    expect(percentOf(0, 5)).toBe(0);
  });

  it("computeVariation devolve null quando o período anterior foi 0", () => {
    expect(computeVariation(5, 0)).toBeNull();
    expect(computeVariation(0, 0)).toBeNull();
  });

  it("computeVariation calcula crescimento e queda", () => {
    expect(computeVariation(15, 10)).toBe(50);
    expect(computeVariation(5, 10)).toBe(-50);
    expect(computeVariation(10, 10)).toBe(0);
  });
});

describe("computeChurnRate", () => {
  it("sem assinantes e sem cancelamentos não há taxa", () => {
    expect(computeChurnRate(0, 0)).toBeNull();
  });

  it("cancelamentos sobre (ativos + cancelados)", () => {
    expect(computeChurnRate(1, 9)).toBe(10);
    expect(computeChurnRate(0, 10)).toBe(0);
  });

  it("só cancelamentos, nenhum ativo = 100%", () => {
    expect(computeChurnRate(2, 0)).toBe(100);
  });
});

describe("computeTrialConversion", () => {
  it("nenhum trial encerrado não é 0% nem 100%", () => {
    expect(computeTrialConversion(0, 0)).toBeNull();
  });

  it("convertidos sobre encerrados", () => {
    expect(computeTrialConversion(1, 3)).toBe(25);
    expect(computeTrialConversion(0, 4)).toBe(0);
    expect(computeTrialConversion(5, 0)).toBe(100);
  });
});

describe("computeTicket", () => {
  it("sem pedidos válidos não há ticket médio", () => {
    expect(computeTicket(0, 0)).toBeNull();
  });

  it("divide o valor transacionado pelos pedidos não cancelados", () => {
    expect(computeTicket(180, 3)).toBe(60);
  });
});

describe("formatDayLabel", () => {
  it("2026-10-08 vira 08/10", () => {
    expect(formatDayLabel("2026-10-08")).toBe("08/10");
    expect(formatDayLabel("2026-01-02")).toBe("02/01");
  });

  it("formato inesperado volta como veio", () => {
    expect(formatDayLabel("hoje")).toBe("hoje");
  });
});

describe("ordersSeries", () => {
  it("mapeia pedidos por dia para a série do gráfico", () => {
    expect(
      ordersSeries([
        { date: "2026-10-07", orders: 3, gmv: 90 },
        { date: "2026-10-08", orders: 0, gmv: 0 },
      ])
    ).toEqual([
      { month: "2026-10-07", total: 3 },
      { month: "2026-10-08", total: 0 },
    ]);
  });
});
