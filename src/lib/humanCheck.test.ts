import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ host: "loja.exemplo.com" as string | null }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (k: string) => (k.toLowerCase() === "host" ? h.host : null) }) }));
vi.mock("@/lib/rateLimit", () => ({ getClientIp: async () => "203.0.113.7" }));
import { humanCheckError, humanTokenError } from "./humanCheck";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  h.host = "loja.exemplo.com";
});

const form = (token?: string) => {
  const f = new FormData();
  if (token !== undefined) f.set("cf-turnstile-response", token);
  return f;
};
const on = () => {
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "0x4AAAAreal-secret");
};
const cloudflare = (...bodies: unknown[]) => {
  const fn = vi.fn();
  for (const b of bodies) fn.mockResolvedValueOnce({ ok: true, json: async () => b });
  vi.stubGlobal("fetch", fn);
  return fn;
};

describe("humanCheckError", () => {
  it("desligado: nunca bloqueia", async () => {
    expect(await humanCheckError(form(), "login")).toBeNull();
  });
  it("uma chave só: nunca bloqueia e avisa uma única vez, sem vazar valores", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "segredo-que-nao-pode-aparecer");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await humanCheckError(form(), "login")).toBeNull();
    expect(await humanCheckError(form(), "login")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("segredo-que-nao-pode-aparecer");
    warn.mockRestore();
  });
  it("ligado: sem token bloqueia sem chamar a Cloudflare", async () => {
    on();
    const f = cloudflare();
    expect(await humanCheckError(form(), "login")).toMatch(/não é um robô/);
    expect(f).not.toHaveBeenCalled();
  });
  it("ligado: token válido, da ação e do domínio certos, passa", async () => {
    on();
    cloudflare({ success: true, hostname: "loja.exemplo.com", action: "login" });
    expect(await humanCheckError(form("bom"), "login")).toBeNull();
  });
  it("ligado: token de outro domínio ou de outra ação é recusado", async () => {
    on();
    cloudflare({ success: true, hostname: "evil.com", action: "login" }, { success: true, hostname: "loja.exemplo.com", action: "cadastro" });
    expect(await humanCheckError(form("t1"), "login")).toMatch(/não é um robô/);
    expect(await humanCheckError(form("t2"), "login")).toMatch(/não é um robô/);
  });
  it("ligado: TURNSTILE_ALLOWED_HOSTNAMES substitui o Host (atrás de proxy que o reescreve)", async () => {
    on();
    vi.stubEnv("TURNSTILE_ALLOWED_HOSTNAMES", "www.exemplo.com, exemplo.com");
    h.host = "interno.vercel.app";
    cloudflare({ success: true, hostname: "www.exemplo.com", action: "login" });
    expect(await humanCheckError(form("t"), "login")).toBeNull();
  });
  it("ligado: token reutilizado/expirado e Cloudflare indisponível bloqueiam com mensagem apropriada", async () => {
    on();
    cloudflare({ success: false, "error-codes": ["timeout-or-duplicate"] });
    expect(await humanCheckError(form("usado"), "login")).toMatch(/expirou ou já foi usada/);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("rede")));
    expect(await humanCheckError(form("x"), "login")).toMatch(/Tente novamente em instantes/);
  });
});

describe("humanTokenError (checkout, sem <form action>)", () => {
  it("desligado: não bloqueia, mesmo sem token", async () => {
    expect(await humanTokenError(undefined, "pedido")).toBeNull();
  });
  it("ligado: exige a ação 'pedido' — token gerado para o login não vale no checkout", async () => {
    on();
    cloudflare({ success: true, hostname: "loja.exemplo.com", action: "login" }, { success: true, hostname: "loja.exemplo.com", action: "pedido" });
    expect(await humanTokenError("do-login", "pedido")).toMatch(/não é um robô/);
    expect(await humanTokenError("do-pedido", "pedido")).toBeNull();
  });
  it("ligado: token ausente ou de tipo errado bloqueia sem chamar a Cloudflare", async () => {
    on();
    const f = cloudflare();
    for (const t of [undefined, null, "", 42, {}]) expect(await humanTokenError(t, "pedido"), String(t)).toMatch(/não é um robô/);
    expect(f).not.toHaveBeenCalled();
  });
  it("ligado: token reutilizado (a Cloudflare responde timeout-or-duplicate) é recusado como expirado", async () => {
    on();
    cloudflare({ success: true, hostname: "loja.exemplo.com", action: "pedido" }, { success: false, "error-codes": ["timeout-or-duplicate"] });
    expect(await humanTokenError("mesmo-token", "pedido")).toBeNull();
    expect(await humanTokenError("mesmo-token", "pedido")).toMatch(/expirou ou já foi usada/);
  });
});
