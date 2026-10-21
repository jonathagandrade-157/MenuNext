import { describe, expect, it } from "vitest";
import { scrubSensitiveRequestData } from "./sentryScrub";

describe("scrubSensitiveRequestData", () => {
  it("remove o token do webhook, Authorization, cookies e chaves de API, sem diferenciar maiúsculas", () => {
    const event = scrubSensitiveRequestData({
      request: {
        headers: {
          "asaas-access-token": "segredo-do-webhook",
          Authorization: "Bearer segredo-do-cron",
          Cookie: "sb=sessao",
          "X-Api-Key": "chave",
          access_token: "chave-asaas",
          "content-type": "application/json",
          "user-agent": "Asaas",
        },
        cookies: { sb: "sessao" },
      },
    });
    const headers = event.request.headers as Record<string, unknown>;
    for (const name of ["asaas-access-token", "Authorization", "Cookie", "X-Api-Key", "access_token"]) {
      expect(headers[name]).toBe("[removido]");
    }
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["user-agent"]).toBe("Asaas");
    expect(event.request.cookies).toBe("[removido]");
    expect(JSON.stringify(event)).not.toMatch(/segredo|sessao|chave/);
  });

  it("evento sem requisição ou sem cabeçalhos passa sem erro", () => {
    expect(scrubSensitiveRequestData({})).toEqual({});
    expect(scrubSensitiveRequestData({ request: {} })).toEqual({ request: {} });
  });
});
