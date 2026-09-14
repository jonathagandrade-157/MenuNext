import { describe, expect, it } from "vitest";
import { getStartOfDayInTimeZone, SAO_PAULO_TIME_ZONE } from "./timezone";

describe("getStartOfDayInTimeZone — America/Sao_Paulo (UTC-3, sem horário de verão desde 2019)", () => {
  it("meio-dia em UTC (09h em SP): início do dia é a meia-noite de SP do MESMO dia", () => {
    const now = new Date("2026-09-09T12:00:00.000Z");
    const start = getStartOfDayInTimeZone(now, SAO_PAULO_TIME_ZONE);
    expect(start.toISOString()).toBe("2026-09-09T03:00:00.000Z");
  });

  it("BUG CORRIGIDO: 01h UTC ainda é 22h do dia anterior em SP — início do dia deve ser o dia anterior, não o dia UTC", () => {
    const now = new Date("2026-09-09T01:00:00.000Z");
    const start = getStartOfDayInTimeZone(now, SAO_PAULO_TIME_ZONE);
    expect(start.toISOString()).toBe("2026-09-08T03:00:00.000Z");
  });

  it("exatamente na virada da meia-noite de SP: retorna o próprio instante", () => {
    const now = new Date("2026-09-09T03:00:00.000Z");
    const start = getStartOfDayInTimeZone(now, SAO_PAULO_TIME_ZONE);
    expect(start.toISOString()).toBe("2026-09-09T03:00:00.000Z");
  });

  it("um segundo antes da meia-noite de SP: ainda pertence ao dia anterior", () => {
    const now = new Date("2026-09-09T02:59:59.000Z");
    const start = getStartOfDayInTimeZone(now, SAO_PAULO_TIME_ZONE);
    expect(start.toISOString()).toBe("2026-09-08T03:00:00.000Z");
  });
});
