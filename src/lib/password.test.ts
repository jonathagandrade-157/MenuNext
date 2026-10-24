import { describe, expect, it } from "vitest";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, validatePassword } from "./password";

describe("validatePassword", () => {
  it("aceita uma senha razoável", () => {
    expect(validatePassword("Cardapio-9x!", { email: "joao@loja.com", name: "João Silva" })).toEqual({ ok: true });
    expect(validatePassword("tres caes azuis")).toEqual({ ok: true });
  });

  it("recusa curta (menos de 8) e a antiga de 6", () => {
    expect(validatePassword("abc123").ok).toBe(false);
    expect(validatePassword("a".repeat(PASSWORD_MIN_LENGTH - 1)).ok).toBe(false);
    expect(validatePassword("abcdefg1").ok).toBe(true);
  });

  it("recusa as que passam do limite do bcrypt (72 bytes), inclusive acentos que ocupam 2 bytes", () => {
    expect(validatePassword("a1".repeat(PASSWORD_MAX_LENGTH / 2)).ok).toBe(true);
    expect(validatePassword("a1".repeat(PASSWORD_MAX_LENGTH / 2) + "x").ok).toBe(false);
    expect(validatePassword("é1".repeat(30)).ok).toBe(false); // 30 × 3 bytes = 90
  });

  it("recusa senhas óbvias, em qualquer caixa", () => {
    for (const p of ["12345678", "Password1", "SENHA123", "qwertyui", "MenuNext123", "aaaaaaaa"]) {
      expect(validatePassword(p).ok, p).toBe(false);
    }
  });

  it("recusa só números", () => {
    expect(validatePassword("19876543210").ok).toBe(false);
  });

  it("recusa a que contém o e-mail ou é só o nome", () => {
    expect(validatePassword("joaosilva2026", { email: "joaosilva@loja.com" }).ok).toBe(false);
    expect(validatePassword("MARIANA", { name: "Mariana Souza" }).ok).toBe(false);
    // e-mail muito curto não vira regra (evita falso positivo)
    expect(validatePassword("zeca-forte-1", { email: "ze@loja.com" }).ok).toBe(true);
  });

  it("a mensagem diz o motivo em português", () => {
    const r = validatePassword("abc");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("8 caracteres");
  });
});
