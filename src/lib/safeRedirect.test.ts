import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safeRedirect";

const login = { allowPanel: true };
const signup = { allowPanel: false };

describe("safeNextPath", () => {
  it("aceita convite nos dois modos", () => {
    expect(safeNextPath("/convite/abc123", login)).toBe("/convite/abc123");
    expect(safeNextPath("/convite/abc123", signup)).toBe("/convite/abc123");
  });

  it("aceita o painel só no login, com subcaminho, query e hash", () => {
    for (const p of ["/painel", "/painel/pedidos", "/painel/marketing?x=1", "/painel/configuracoes#contato", "/onboarding/passo-3", "/master/auditoria"]) {
      expect(safeNextPath(p, login), p).toBe(p);
      expect(safeNextPath(p, signup), p).toBeNull();
    }
  });

  it("recusa qualquer coisa que possa sair do site", () => {
    for (const p of [
      "https://evil.com",
      "//evil.com",
      "///evil.com",
      "/\\evil.com",
      "/painel\\..\\x",
      "javascript:alert(1)",
      "evil.com/painel",
      "/painelx",
      "/painel/\nSet-Cookie: a=b",
      "/painel/\u0000",
      "/loja/qualquer",
      "/",
      "",
    ]) {
      expect(safeNextPath(p, login), JSON.stringify(p)).toBeNull();
    }
  });

  it("recusa valores que não são texto e caminhos longos demais", () => {
    expect(safeNextPath(undefined, login)).toBeNull();
    expect(safeNextPath(null, login)).toBeNull();
    expect(safeNextPath(["/painel"], login)).toBeNull();
    expect(safeNextPath("/painel/" + "a".repeat(400), login)).toBeNull();
  });
});
