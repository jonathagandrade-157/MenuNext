import { describe, expect, it } from "vitest";
import { ACCESS_STATE_COPY, parseAccessState } from "./accessState";

describe("parseAccessState", () => {
  it("reconhece os três motivos de bloqueio", () => {
    expect(parseAccessState("overdue")).toBe("overdue");
    expect(parseAccessState("cancelled")).toBe("cancelled");
    expect(parseAccessState("trial_expired")).toBe("trial_expired");
  });

  it("null, vazio e valores desconhecidos significam liberado (o banco reforça o bloqueio real)", () => {
    expect(parseAccessState(null)).toBeNull();
    expect(parseAccessState(undefined)).toBeNull();
    expect(parseAccessState("")).toBeNull();
    expect(parseAccessState("active")).toBeNull();
    expect(parseAccessState(42)).toBeNull();
  });
});

describe("ACCESS_STATE_COPY", () => {
  it("todo motivo tem selo e mensagem, e o trial expirado explica que são 30 dias de teste", () => {
    for (const copy of Object.values(ACCESS_STATE_COPY)) {
      expect(copy.badge.length).toBeGreaterThan(0);
      expect(copy.message.length).toBeGreaterThan(0);
    }
    expect(ACCESS_STATE_COPY.trial_expired.message).toContain("teste");
  });
});
