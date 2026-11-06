import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rateLimit", () => ({ getClientIp: async () => "203.0.113.7" }));
import { humanCheckError } from "./humanCheck";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const form = (token?: string) => {
  const f = new FormData();
  if (token !== undefined) f.set("cf-turnstile-response", token);
  return f;
};

describe("humanCheckError", () => {
  it("desligado: nunca bloqueia", async () => {
    expect(await humanCheckError(form())).toBeNull();
  });
  it("ligado: sem token bloqueia; com token aceito pela Cloudflare passa; recusado bloqueia", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ success: false }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await humanCheckError(form())).toMatch(/não é um robô/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await humanCheckError(form("bom"))).toBeNull();
    expect(await humanCheckError(form("ruim"))).toMatch(/não é um robô/);
  });
});
