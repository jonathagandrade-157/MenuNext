import { describe, expect, it, vi } from "vitest";
import { buildContentSecurityPolicy } from "./csp";
import { humanCheckMessage, turnstileEnabled, verifyHuman } from "./turnstile";

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
  it("token recusado pela Cloudflare = inválido", async () => {
    expect(await verifyHuman("tok", null, ON, reply({ success: false, "error-codes": ["timeout-or-duplicate"] }))).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyHuman("tok", null, ON, reply({}))).toEqual({ ok: false, reason: "invalid" });
  });
  it("Cloudflare fora do ar ou erro de rede = negado (falha fechado)", async () => {
    expect(await verifyHuman("tok", null, ON, reply({}, false))).toEqual({ ok: false, reason: "unavailable" });
    expect(await verifyHuman("tok", null, ON, vi.fn().mockRejectedValue(new Error("boom")) as unknown as typeof fetch)).toEqual({ ok: false, reason: "unavailable" });
  });
  it("mensagens amigáveis", () => {
    expect(humanCheckMessage("missing")).toMatch(/não é um robô/);
    expect(humanCheckMessage("unavailable")).toMatch(/Tente novamente/);
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
