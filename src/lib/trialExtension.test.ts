import { describe, expect, it } from "vitest";
import { parseExtensionDays, summarizeTrial } from "./trialExtension";

const NOW = new Date("2026-10-08T12:00:00Z");

describe("parseExtensionDays", () => {
  it("aceita só os prazos oferecidos", () => {
    expect(parseExtensionDays("7")).toBe(7);
    expect(parseExtensionDays("60")).toBe(60);
  });

  it("recusa qualquer outro valor", () => {
    for (const raw of ["0", "-7", "8", "366", "abc", "", null, undefined]) {
      expect(parseExtensionDays(raw)).toBeNull();
    }
  });
});

describe("summarizeTrial", () => {
  it("sem data, a loja nunca teve trial", () => {
    expect(summarizeTrial(null, NOW)).toEqual({ state: "none" });
  });

  it("trial no futuro está ativo e conta dias restantes", () => {
    expect(summarizeTrial("2026-10-11T12:00:00Z", NOW)).toEqual({
      state: "active",
      endsAt: "2026-10-11T12:00:00Z",
      daysLeft: 3,
    });
  });

  it("faltando poucas horas ainda é 1 dia", () => {
    expect(summarizeTrial("2026-10-08T14:00:00Z", NOW)).toMatchObject({ state: "active", daysLeft: 1 });
  });

  it("trial que acabou agora ou antes está expirado", () => {
    expect(summarizeTrial("2026-10-08T12:00:00Z", NOW)).toEqual({ state: "expired", endsAt: "2026-10-08T12:00:00Z" });
    expect(summarizeTrial("2026-10-01T00:00:00Z", NOW).state).toBe("expired");
  });
});
