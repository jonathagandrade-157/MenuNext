import { describe, expect, it } from "vitest";
import { computeTrialProgress } from "./trial";

const now = new Date("2026-10-21T12:00:00Z");

describe("computeTrialProgress", () => {
  it("calcula dias restantes e % usado de um teste de 30 dias no meio", () => {
    const p = computeTrialProgress("2026-10-06T12:00:00Z", "2026-11-05T12:00:00Z", now)!;
    expect(p.totalDays).toBe(30);
    expect(p.daysLeft).toBe(15);
    expect(p.usedDays).toBe(15);
    expect(p.percentUsed).toBe(50);
  });

  it("conta o dia corrente: faltando poucas horas ainda é 1 dia", () => {
    const p = computeTrialProgress("2026-09-21T12:00:00Z", "2026-10-21T18:00:00Z", now)!;
    expect(p.daysLeft).toBe(1);
  });

  it("teste prorrogado pelo master usa o total real (início até o novo fim)", () => {
    const p = computeTrialProgress("2026-10-01T12:00:00Z", "2026-12-10T12:00:00Z", now)!;
    expect(p.totalDays).toBe(70);
    expect(p.daysLeft).toBe(50);
  });

  it("sem data de fim ou já terminado não há progresso", () => {
    expect(computeTrialProgress(null, null, now)).toBeNull();
    expect(computeTrialProgress("2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z", now)).toBeNull();
  });

  it("sem data de início assume 30 dias e nunca passa de 100%", () => {
    const p = computeTrialProgress(null, "2026-10-22T12:00:00Z", now)!;
    expect(p.totalDays).toBe(30);
    expect(p.percentUsed).toBeLessThanOrEqual(100);
    expect(p.daysLeft).toBe(1);
  });
});
