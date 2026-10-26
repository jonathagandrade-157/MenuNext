import { describe, expect, it } from "vitest";
import {
  PASSWORD_RESET_COOKIE_MAX_AGE_SECONDS,
  friendlyUpdatePasswordError,
  isPlausibleEmail,
} from "@/lib/passwordReset";

describe("isPlausibleEmail", () => {
  it("aceita endereços comuns", () => {
    expect(isPlausibleEmail("dono@restaurante.com.br")).toBe(true);
    expect(isPlausibleEmail("a+b@x.io")).toBe(true);
  });

  it("recusa vazio, sem arroba, sem domínio, com espaço ou grande demais", () => {
    expect(isPlausibleEmail("")).toBe(false);
    expect(isPlausibleEmail("semarroba.com")).toBe(false);
    expect(isPlausibleEmail("a@b")).toBe(false);
    expect(isPlausibleEmail("a b@c.com")).toBe(false);
    expect(isPlausibleEmail(`${"a".repeat(250)}@x.com`)).toBe(false);
  });
});

describe("friendlyUpdatePasswordError", () => {
  it("traduz senha repetida, fraca e sessão expirada", () => {
    expect(friendlyUpdatePasswordError("New password should be different from the old password.")).toMatch(/diferente/);
    expect(friendlyUpdatePasswordError("Password is known to be weak and easy to guess")).toMatch(/mais forte/);
    expect(friendlyUpdatePasswordError("Auth session missing!")).toMatch(/expirou/);
  });

  it("não devolve o texto cru de erros desconhecidos", () => {
    const text = friendlyUpdatePasswordError("duplicate key value violates unique constraint foo");
    expect(text).not.toMatch(/duplicate|constraint/);
  });
});

describe("cookie de redefinição", () => {
  it("dura no máximo 15 minutos", () => {
    expect(PASSWORD_RESET_COOKIE_MAX_AGE_SECONDS).toBeLessThanOrEqual(15 * 60);
  });
});
