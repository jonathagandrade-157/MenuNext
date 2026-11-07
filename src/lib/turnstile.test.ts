import { describe, expect, it, vi } from "vitest";
import { buildContentSecurityPolicy } from "./csp";
import { humanCheckMessage, isTurnstileTestSecret, turnstileEnabled, turnstilePartiallyConfigured, verifyHuman } from "./turnstile";

const ON = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" };
const reply = (body: unknown, ok = true) => vi.fn().mockResolvedValue({ ok, json: async () => body }) as unknown as typeof fetch;

describe("turnstileEnabled", () => {
  it("exige as duas chaves (só uma não liga, para não trancar todo mundo)", () => {
    expect(turnstileEnabled(ON)).toBe(true);
    expect(turnstileEnabled({ TURNSTILE_SECRET_KEY: "s" })).toBe(false);
    expect(turnstileEnabled({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "k" })).toBe(false);
    expect(turnstileEnabled({ ...ON, TURNSTILE_SECRET_KEY: "  " })).toBe(false);
    expect(turnstileEnabled({})).toBe(false);
  });
});

describe("verifyHuman", () => {
  it("desligado: libera sem chamar a rede", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    expect(await verifyHuman(undefined, "1.1.1.1", {}, f)).toEqual({ ok: true });
    expect(f).not.toHaveBeenCalled();
  });
  it("ligado: sem token, vazio, não-texto ou gigante é recusado sem chamar a rede", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    for (const t of [undefined, null, "", 123, {}, "x".repeat(2049)]) {
      expect(await verifyHuman(t, "1.1.1.1", ON, f), String(t).slice(0, 10)).toEqual({ ok: false, reason: "missing" });
    }
    expect(f).not.toHaveBeenCalled();
  });
  it("token válido passa e o segredo vai só no corpo para a Cloudflare", async () => {
    const f = reply({ success: true });
    expect(await verifyHuman("tok", "203.0.113.7", ON, f)).toEqual({ ok: true });
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = String(init.body);
    expect(body).toContain("secret=secret");
    expect(body).toContain("response=tok");
    expect(body).toContain("remoteip=203.0.113.7");
  });
  it("IP desconhecido não é enviado", async () => {
    const f = reply({ success: true });
    await verifyHuman("tok", "unknown", ON, f);
    expect(String((f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body)).not.toContain("remoteip");
  });
  it("token vencido ou já usado (timeout-or-duplicate) é 'expired', distinto de inválido", async () => {
    expect(await verifyHuman("tok", null, ON, reply({ success: false, "error-codes": ["timeout-or-duplicate"] }))).toEqual({ ok: false, reason: "expired" });
    expect(await verifyHuman("tok", null, ON, reply({ success: false, "error-codes": ["invalid-input-response"] }))).toEqual({ ok: false, reason: "invalid" });
    expect(humanCheckMessage("expired")).toMatch(/expirou ou já foi usada/);
  });
  it("token recusado pela Cloudflare = inválido", async () => {
    expect(await verifyHuman("tok", null, ON, reply({ success: false, "error-codes": ["invalid-input-response"] }))).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyHuman("tok", null, ON, reply({}))).toEqual({ ok: false, reason: "invalid" });
  });
  it("Cloudflare fora do ar ou erro de rede = negado (falha fechado)", async () => {
    expect(await verifyHuman("tok", null, ON, reply({}, false))).toEqual({ ok: false, reason: "unavailable" });
    expect(await verifyHuman("tok", null, ON, vi.fn().mockRejectedValue(new Error("boom")) as unknown as typeof fetch)).toEqual({ ok: false, reason: "unavailable" });
  });
  it("hostname devolvido precisa ser o esperado (token de outro site não vale)", async () => {
    const ok = reply({ success: true, hostname: "Loja.Exemplo.com", action: "login" });
    expect(await verifyHuman("t", null, ON, ok, { hostnames: ["loja.exemplo.com:443"], action: "login" })).toEqual({ ok: true });
    for (const hostname of ["evil.com", "loja.exemplo.com.evil.com", "", undefined]) {
      expect(await verifyHuman("t", null, ON, reply({ success: true, hostname, action: "login" }), { hostnames: ["loja.exemplo.com"], action: "login" }), String(hostname)).toEqual({ ok: false, reason: "hostname" });
    }
  });
  it("action devolvida precisa ser a do formulário (token do login não serve no cadastro)", async () => {
    const r = (action?: string) => reply({ success: true, hostname: "loja.exemplo.com", action });
    expect(await verifyHuman("t", null, ON, r("cadastro"), { hostnames: ["loja.exemplo.com"], action: "cadastro" })).toEqual({ ok: true });
    expect(await verifyHuman("t", null, ON, r("login"), { hostnames: ["loja.exemplo.com"], action: "cadastro" })).toEqual({ ok: false, reason: "action" });
    expect(await verifyHuman("t", null, ON, r(undefined), { hostnames: ["loja.exemplo.com"], action: "cadastro" })).toEqual({ ok: false, reason: "action" });
  });
  it("sem expectativa declarada, só o success importa", async () => {
    expect(await verifyHuman("t", null, ON, reply({ success: true, hostname: "qualquer.com" }))).toEqual({ ok: true });
  });
  it("segredos de TESTE oficiais da Cloudflare pulam a conferência de contexto (a resposta deles traz example.com e nenhuma action)", async () => {
    const testEnv = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA", TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" };
    expect(await verifyHuman("t", null, testEnv, reply({ success: true, hostname: "example.com" }), { hostnames: ["loja.exemplo.com"], action: "login" })).toEqual({ ok: true });
    expect(isTurnstileTestSecret("2x0000000000000000000000000000000AA")).toBe(true);
    for (const real of ["0x4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "1x0000000000000000000000000000000AB", "", undefined]) expect(isTurnstileTestSecret(real), String(real)).toBe(false);
  });
  it("chave secreta recusada (invalid-input-secret) nega como indisponível, avisa uma vez e não vaza a chave", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = { ...ON, TURNSTILE_SECRET_KEY: "segredo-errado-xyz" };
    const res = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ success: false, "error-codes": ["invalid-input-secret"] }) }) as unknown as typeof fetch;
    expect(await verifyHuman("t", null, bad, res)).toEqual({ ok: false, reason: "unavailable" });
    expect(await verifyHuman("t", null, bad, res)).toEqual({ ok: false, reason: "unavailable" });
    expect(err).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(err.mock.calls)).not.toContain("segredo-errado-xyz");
    err.mockRestore();
  });
  it("resposta não-JSON ou HTTP de erro sem corpo útil = indisponível", async () => {
    const html = vi.fn().mockResolvedValue({ ok: false, json: async () => { throw new Error("html"); } }) as unknown as typeof fetch;
    expect(await verifyHuman("t", null, ON, html)).toEqual({ ok: false, reason: "unavailable" });
  });
  it("mensagens amigáveis", () => {
    expect(humanCheckMessage("missing")).toMatch(/não é um robô/);
    expect(humanCheckMessage("unavailable")).toMatch(/Tente novamente/);
  });
});

describe("configuração com apenas uma chave", () => {
  it("não liga (não tranca ninguém) e é detectada como incompleta", () => {
    expect(turnstileEnabled({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "k" })).toBe(false);
    expect(turnstileEnabled({ TURNSTILE_SECRET_KEY: "s" })).toBe(false);
    expect(turnstilePartiallyConfigured({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "k" })).toBe(true);
    expect(turnstilePartiallyConfigured({ TURNSTILE_SECRET_KEY: "s" })).toBe(true);
    expect(turnstilePartiallyConfigured({})).toBe(false);
    expect(turnstilePartiallyConfigured({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "k", TURNSTILE_SECRET_KEY: "s" })).toBe(false);
    expect(turnstilePartiallyConfigured({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "  ", TURNSTILE_SECRET_KEY: "s" })).toBe(true);
  });
  it("com uma chave só, a CSP também NÃO libera a Cloudflare e verifyHuman libera sem rede", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    expect(await verifyHuman(undefined, null, { TURNSTILE_SECRET_KEY: "s" }, f)).toEqual({ ok: true });
    expect(f).not.toHaveBeenCalled();
    expect(buildContentSecurityPolicy({ nonce: "abc", turnstile: turnstileEnabled({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "k" }) })).not.toContain("cloudflare");
  });
});

describe("CSP com Turnstile", () => {
  it("libera a Cloudflare só quando ligado", () => {
    const off = buildContentSecurityPolicy({ nonce: "abc" });
    const on = buildContentSecurityPolicy({ nonce: "abc", turnstile: true });
    expect(off).not.toContain("challenges.cloudflare.com");
    expect(on).toMatch(/script-src[^;]*challenges\.cloudflare\.com/);
    expect(on).toMatch(/frame-src https:\/\/challenges\.cloudflare\.com/);
    expect(on).toMatch(/connect-src[^;]*challenges\.cloudflare\.com/);
    expect(on).toContain("frame-ancestors 'none'");
  });
});
