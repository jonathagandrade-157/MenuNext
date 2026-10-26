import { describe, expect, it } from "vitest";
import { hashIdentifier, pickClientIp, tooManyAttemptsMessage } from "./rateLimit";

describe("pickClientIp", () => {
  it("usa o primeiro IP do x-forwarded-for", () => {
    expect(pickClientIp("203.0.113.7, 10.0.0.1", null)).toBe("203.0.113.7");
  });

  it("cai para x-real-ip quando não há x-forwarded-for", () => {
    expect(pickClientIp(null, "198.51.100.4")).toBe("198.51.100.4");
  });

  it("aceita IPv6 e normaliza para minúsculas", () => {
    expect(pickClientIp("2001:DB8::1", null)).toBe("2001:db8::1");
  });

  it("recusa lixo, texto malicioso e valores enormes", () => {
    expect(pickClientIp("'; drop table x;--", null)).toBe("unknown");
    expect(pickClientIp("1.1.1.1\nX-Evil: 1", null)).toBe("unknown");
    expect(pickClientIp("a".repeat(100), null)).toBe("unknown");
    expect(pickClientIp(null, null)).toBe("unknown");
    expect(pickClientIp("", "")).toBe("unknown");
  });
});

describe("hashIdentifier", () => {
  it("é estável, ignora caixa e espaços, e não devolve o texto original", () => {
    const a = hashIdentifier("  Maria@Loja.com ");
    expect(a).toBe(hashIdentifier("maria@loja.com"));
    expect(a).toHaveLength(32);
    expect(a).not.toContain("maria");
  });

  it("textos diferentes geram identificadores diferentes", () => {
    expect(hashIdentifier("a@x.com")).not.toBe(hashIdentifier("b@x.com"));
  });
});

describe("tooManyAttemptsMessage", () => {
  it("arredonda para cima em minutos, com singular e plural", () => {
    expect(tooManyAttemptsMessage(1)).toContain("1 minuto ");
    expect(tooManyAttemptsMessage(60)).toContain("1 minuto ");
    expect(tooManyAttemptsMessage(61)).toContain("2 minutos");
    expect(tooManyAttemptsMessage(600)).toContain("10 minutos");
    expect(tooManyAttemptsMessage(0)).toContain("1 minuto ");
  });
});
