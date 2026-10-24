import { describe, expect, it } from "vitest";
import { resolveMercadoPagoBaseUrl } from "./mercadopago";

const REAL = "https://api.mercadopago.com";

describe("resolveMercadoPagoBaseUrl", () => {
  it("usa a API real por padrão", () => {
    expect(resolveMercadoPagoBaseUrl({})).toBe(REAL);
  });

  it("aceita override só para loopback http fora de produção", () => {
    expect(resolveMercadoPagoBaseUrl({ MERCADOPAGO_BASE_URL: "http://127.0.0.1:4010/", NODE_ENV: "test" })).toBe(
      "http://127.0.0.1:4010"
    );
    expect(resolveMercadoPagoBaseUrl({ MERCADOPAGO_BASE_URL: "http://localhost:4010", NODE_ENV: "development" })).toBe(
      "http://localhost:4010"
    );
  });

  it("ignora override em produção, para outro host, https ou com credenciais na URL", () => {
    expect(resolveMercadoPagoBaseUrl({ MERCADOPAGO_BASE_URL: "http://127.0.0.1:4010", NODE_ENV: "production" })).toBe(REAL);
    expect(resolveMercadoPagoBaseUrl({ MERCADOPAGO_BASE_URL: "http://evil.example", NODE_ENV: "test" })).toBe(REAL);
    expect(resolveMercadoPagoBaseUrl({ MERCADOPAGO_BASE_URL: "https://127.0.0.1", NODE_ENV: "test" })).toBe(REAL);
    expect(resolveMercadoPagoBaseUrl({ MERCADOPAGO_BASE_URL: "http://user:pw@127.0.0.1", NODE_ENV: "test" })).toBe(REAL);
    expect(resolveMercadoPagoBaseUrl({ MERCADOPAGO_BASE_URL: "não é url", NODE_ENV: "test" })).toBe(REAL);
  });
});
