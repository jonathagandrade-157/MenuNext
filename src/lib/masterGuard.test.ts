import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ headers: new Map<string, string>() }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (k: string) => h.headers.get(k.toLowerCase()) ?? null }) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { assertMasterMfa, assertMasterNetwork } from "./masterGuard";

afterEach(() => {
  vi.unstubAllEnvs();
  h.headers.clear();
});

describe("assertMasterNetwork", () => {
  it("sem configuração não bloqueia", async () => {
    h.headers.set("host", "qualquer.com");
    await expect(assertMasterNetwork()).resolves.toBeUndefined();
  });
  it("host e IP fora da política viram 404", async () => {
    vi.stubEnv("MASTER_HOST", "master.exemplo.com");
    vi.stubEnv("MASTER_ALLOWED_IPS", "203.0.113.7");
    h.headers.set("x-forwarded-host", "master.exemplo.com");
    h.headers.set("x-forwarded-for", "203.0.113.7");
    await expect(assertMasterNetwork()).resolves.toBeUndefined();
    h.headers.set("x-forwarded-for", "198.51.100.1");
    await expect(assertMasterNetwork()).rejects.toThrow("NOT_FOUND");
    h.headers.set("x-forwarded-for", "203.0.113.7");
    h.headers.set("x-forwarded-host", "loja.exemplo.com");
    await expect(assertMasterNetwork()).rejects.toThrow("NOT_FOUND");
  });
  it("cabeçalho de IP com lixo equivale a desconhecido e é negado quando há lista", async () => {
    vi.stubEnv("MASTER_ALLOWED_IPS", "203.0.113.7");
    h.headers.set("x-forwarded-for", "203.0.113.7; DROP");
    await expect(assertMasterNetwork()).rejects.toThrow("NOT_FOUND");
  });
});

describe("assertMasterMfa", () => {
  const supa = (result: unknown) => ({ auth: { mfa: { getAuthenticatorAssuranceLevel: async () => result } } }) as never;
  it("desligado: nem consulta o Supabase", async () => {
    const spy = vi.fn();
    await expect(assertMasterMfa({ auth: { mfa: { getAuthenticatorAssuranceLevel: spy } } } as never)).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
  it("ligado: só AAL2 passa; AAL1, erro ou resposta vazia vão ao desafio", async () => {
    vi.stubEnv("MASTER_REQUIRE_MFA", "true");
    await expect(assertMasterMfa(supa({ data: { currentLevel: "aal2" }, error: null }))).resolves.toBeUndefined();
    for (const r of [{ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null }, { data: null, error: { message: "x" } }, { data: null, error: null }]) {
      await expect(assertMasterMfa(supa(r))).rejects.toThrow("REDIRECT:/master-mfa");
    }
  });
});

describe("cobertura estática: nada do Master fica sem proteção", () => {
  const ROOT = path.resolve(__dirname, "..");
  const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
  it("o layout do Master chama as duas verificações", () => {
    const layout = read("app/master/layout.tsx");
    expect(layout).toContain("assertMasterNetwork(");
    expect(layout).toContain("assertMasterMfa(");
  });
  it("requireMasterPage (usado por páginas e ações) chama as duas verificações", () => {
    const tenant = read("lib/tenant.ts");
    const body = tenant.slice(tenant.indexOf("export async function requireMasterPage"));
    const fn = body.slice(0, body.indexOf("\n}\n"));
    expect(fn).toContain("assertMasterNetwork(");
    expect(fn).toContain("assertMasterMfa(");
  });
  it("o proxy aplica a política antes de qualquer outra coisa nas rotas do Master", () => {
    const proxy = read("proxy.ts");
    expect(proxy).toContain("isMasterPath(");
    expect(proxy.indexOf("evaluateMasterNetwork(")).toBeLessThan(proxy.indexOf("createServerClient("));
  });
  it("ninguém checa is_platform_admin por fora do guarda central, exceto layout, tela de MFA e o próprio tenant.ts", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) {
          const rel = path.relative(ROOT, full).replaceAll("\\", "/");
          if (/isPlatformAdmin\(|rpc\(\s*["']is_platform_admin/.test(fs.readFileSync(full, "utf8"))) offenders.push(rel);
        }
      }
    };
    walk(ROOT);
    expect(offenders.sort()).toEqual(["app/master-mfa/page.tsx", "app/master/layout.tsx", "lib/tenant.ts"]);
  });
});
