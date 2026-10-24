import { describe, expect, it } from "vitest";
import { needsTermsAcceptance } from "./termsAcceptance";

describe("needsTermsAcceptance", () => {
  const current = "21 de outubro de 2026";

  it("pede aceite de quem nunca registrou (conta anterior ao recurso)", () => {
    expect(needsTermsAcceptance({}, current)).toBe(true);
    expect(needsTermsAcceptance(null, current)).toBe(true);
    expect(needsTermsAcceptance(undefined, current)).toBe(true);
  });

  it("pede aceite de novo quando a versão aceita é antiga", () => {
    expect(needsTermsAcceptance({ terms_version: "1 de janeiro de 2026" }, current)).toBe(true);
  });

  it("não pede quando a versão aceita é a atual", () => {
    expect(needsTermsAcceptance({ terms_version: current }, current)).toBe(false);
  });
});
