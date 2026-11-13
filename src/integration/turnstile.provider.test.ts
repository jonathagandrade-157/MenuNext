/**
 * Ensaio com a Cloudflare REAL usando os segredos de TESTE oficiais e públicos (documentação do Turnstile). NÃO usa
 * nenhuma chave do projeto e não valida produção. Só roda com TURNSTILE_PROVIDER_TEST=1 e acesso a
 * challenges.cloudflare.com:
 *   1x…AA  sempre aprova          2x…AA  sempre reprova (invalid-input-response)
 *   3x…AA  simula token já usado/vencido (timeout-or-duplicate)
 * Um token realmente expirado ou reutilizado só existe com chaves reais; aqui o 3x…AA reproduz a MESMA resposta.
 */
import { describe, expect, it, vi } from "vitest";
import { verifyHuman } from "@/lib/turnstile";

const enabled = process.env.TURNSTILE_PROVIDER_TEST === "1";
const env = (secret: string) => ({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA", TURNSTILE_SECRET_KEY: secret });
const PASS = "1x0000000000000000000000000000000AA";
const FAIL = "2x0000000000000000000000000000000AA";
const SPENT = "3x0000000000000000000000000000000AA";

describe.skipIf(!enabled)("Turnstile — API real da Cloudflare com chaves de teste oficiais", () => {
  it("segredo que sempre aprova: token aceito", async () => {
    expect(await verifyHuman("XXXX.DUMMY.TOKEN.XXXX", "203.0.113.7", env(PASS), fetch, { action: "login", hostnames: ["loja.exemplo.com"] })).toEqual({ ok: true });
  });
  it("segredo que sempre reprova: token inválido", async () => {
    expect(await verifyHuman("XXXX.DUMMY.TOKEN.XXXX", "203.0.113.7", env(FAIL), fetch, { action: "login" })).toEqual({ ok: false, reason: "invalid" });
  });
  it("segredo que simula token vencido/já usado: 'expired'", async () => {
    expect(await verifyHuman("XXXX.DUMMY.TOKEN.XXXX", null, env(SPENT), fetch)).toEqual({ ok: false, reason: "expired" });
  });
  it("NOSSA chave secreta desconhecida pela Cloudflare (invalid-input-secret): nega como indisponível e avisa o operador", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await verifyHuman("XXXX.DUMMY.TOKEN.XXXX", null, env("1x0000000000000000000000000000000AB"), fetch)).toEqual({ ok: false, reason: "unavailable" });
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain("1x0000000000000000000000000000000AB");
    error.mockRestore();
  });
  it("token ausente nem chega à Cloudflare", async () => {
    expect(await verifyHuman("", null, env(PASS), fetch)).toEqual({ ok: false, reason: "missing" });
  });
  it("indisponibilidade: rede que falha nega (falha fechado)", async () => {
    const down = (() => Promise.reject(new Error("ENOTFOUND challenges.cloudflare.com"))) as unknown as typeof fetch;
    expect(await verifyHuman("XXXX.DUMMY.TOKEN.XXXX", null, env(PASS), down)).toEqual({ ok: false, reason: "unavailable" });
  });
});
