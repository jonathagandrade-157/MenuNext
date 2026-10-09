import { describe, expect, it } from "vitest";
import { resolveAsaasBaseUrl } from "./asaas";

const SANDBOX = "https://api-sandbox.asaas.com/v3";
const PROD = "https://api.asaas.com/v3";

describe("resolveAsaasBaseUrl", () => {
  it("padrão é o sandbox (mais seguro); só 'production' usa a API real", () => {
    expect(resolveAsaasBaseUrl({})).toBe(SANDBOX);
    expect(resolveAsaasBaseUrl({ ASAAS_ENV: "sandbox" })).toBe(SANDBOX);
    expect(resolveAsaasBaseUrl({ ASAAS_ENV: "qualquer-coisa" })).toBe(SANDBOX);
    expect(resolveAsaasBaseUrl({ ASAAS_ENV: "production" })).toBe(PROD);
  });

  it("aceita ASAAS_BASE_URL apenas para este computador, fora de produção", () => {
    expect(resolveAsaasBaseUrl({ ASAAS_BASE_URL: "http://127.0.0.1:54340/v3" })).toBe("http://127.0.0.1:54340/v3");
    expect(resolveAsaasBaseUrl({ ASAAS_BASE_URL: "http://localhost:9000/v3/" })).toBe("http://localhost:9000/v3");
  });

  it("nunca envia a chave a outro endereço: hosts remotos, https e URLs inválidas são ignorados", () => {
    for (const evil of [
      "https://evil.example.com/v3",
      "http://evil.example.com/v3",
      "http://127.0.0.1.evil.com/v3",
      "http://localhost.evil.com/v3",
      "https://127.0.0.1/v3",
      "http://user@evil.com:80@127.0.0.1/v3",
      "ftp://127.0.0.1/v3",
      "nao-e-url",
      "",
    ]) {
      expect(resolveAsaasBaseUrl({ ASAAS_BASE_URL: evil })).toBe(SANDBOX);
    }
  });

  it("em produção o override é ignorado, mesmo apontando para o próprio computador", () => {
    expect(resolveAsaasBaseUrl({ ASAAS_ENV: "production", ASAAS_BASE_URL: "http://127.0.0.1:54340/v3" })).toBe(PROD);
  });
});
