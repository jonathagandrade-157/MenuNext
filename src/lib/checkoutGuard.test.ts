import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@/lib/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rateLimit")>()),
  checkRateLimit: h.check,
}));

import { hashIdentifier } from "./rateLimit";
import { ORDER_LIMITS, buildCouponLimits, buildOrderLimits, enforceLimits, normalizeStoreSlug, phoneDigits } from "./checkoutGuard";

describe("normalizeStoreSlug", () => {
  it("aceita slug comum e ignora caixa e espaços", () => {
    expect(normalizeStoreSlug("  Menunext-Teste ")).toBe("menunext-teste");
  });

  it("recusa o que não tem cara de slug (não vira balde)", () => {
    for (const bad of ["", "a b", "x".repeat(61), "../etc", "loja;drop", "-loja", "lo\nja"]) {
      expect(normalizeStoreSlug(bad), bad).toBeNull();
    }
  });
});

describe("buildOrderLimits", () => {
  it("monta limites por loja+IP, por loja e por telefone", () => {
    const specs = buildOrderLimits({ slug: "loja-a", ip: "203.0.113.7", phone: "(11) 99999-0001" });
    expect(specs.map((s) => s.scope)).toEqual(["pedido:loja-ip", "pedido:loja", "pedido:fone"]);
    expect(specs[0].identifier).toBe(`loja-a:${hashIdentifier("203.0.113.7")}`);
    expect(specs[0].identifier).not.toContain("203.0.113.7"); // IP nunca em texto no balde
    expect(specs[1].identifier).toBe("loja-a");
  });

  it("o telefone nunca vai em texto puro para o balde e formatos diferentes caem no mesmo balde", () => {
    const a = buildOrderLimits({ slug: "loja-a", ip: "1.1.1.1", phone: "(11) 99999-0001" }).find((s) => s.scope === "pedido:fone");
    const b = buildOrderLimits({ slug: "loja-a", ip: "2.2.2.2", phone: "11999990001" }).find((s) => s.scope === "pedido:fone");
    const c = buildOrderLimits({ slug: "loja-a", ip: "2.2.2.2", phone: "+55 11 99999-0001" }).find((s) => s.scope === "pedido:fone");
    expect(a?.identifier).toBe(b?.identifier);
    expect(a?.identifier).toBe(c?.identifier);
    expect(a?.identifier).not.toContain("99999");
  });

  it("lojas diferentes têm baldes diferentes (uma loja não gasta a cota da outra)", () => {
    const a = buildOrderLimits({ slug: "loja-a", ip: "1.1.1.1", phone: "11999990001" });
    const b = buildOrderLimits({ slug: "loja-b", ip: "1.1.1.1", phone: "11999990001" });
    expect(a.map((s) => s.identifier)).not.toEqual(b.map((s) => s.identifier));
  });

  it("sem slug válido não cria baldes; telefone curto não cria o balde do telefone", () => {
    expect(buildOrderLimits({ slug: "../x", ip: "1.1.1.1", phone: "11999990001" })).toEqual([]);
    expect(buildOrderLimits({ slug: "loja-a", ip: "1.1.1.1", phone: "123" }).map((s) => s.scope)).toEqual(["pedido:loja-ip", "pedido:loja"]);
  });

  it("limites provisórios de homologação: IP 30, IP+loja 15, telefone 8, loja 120 (10 min)", () => {
    expect(ORDER_LIMITS).toEqual({
      ip: { limit: 30, windowSeconds: 600 },
      storeIp: { limit: 15, windowSeconds: 600 },
      store: { limit: 120, windowSeconds: 600 },
      phone: { limit: 8, windowSeconds: 600 },
    });
  });

  it("os limites do app ficam abaixo da retaguarda do banco (300 por loja, 15 por telefone)", () => {
    for (const s of buildOrderLimits({ slug: "loja-a", ip: "1.1.1.1", phone: "11999990001" })) {
      expect(s.rule.limit).toBeGreaterThan(0);
    }
    const byScope = Object.fromEntries(buildOrderLimits({ slug: "loja-a", ip: "1.1.1.1", phone: "11999990001" }).map((s) => [s.scope, s.rule.limit]));
    expect(byScope["pedido:loja"]).toBeLessThan(300);
    expect(byScope["pedido:fone"]).toBeLessThan(15);
  });
});

describe("buildCouponLimits / phoneDigits", () => {
  it("cupom: um balde por loja", () => {
    expect(buildCouponLimits({ slug: "Loja-A" })).toEqual([{ scope: "cupom:loja", identifier: "loja-a", rule: { limit: 120, windowSeconds: 60 } }]);
    expect(buildCouponLimits({ slug: "???" })).toEqual([]);
  });

  it("phoneDigits só deixa números", () => {
    expect(phoneDigits("+55 (11) 9 9999-0001")).toBe("5511999990001");
  });
});

describe("enforceLimits", () => {
  beforeEach(() => h.check.mockReset());

  it("libera quando todos passam", async () => {
    h.check.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    const result = await enforceLimits(buildOrderLimits({ slug: "loja-a", ip: "1.1.1.1", phone: "11999990001" }));
    expect(result).toEqual({ allowed: true });
    expect(h.check).toHaveBeenCalledTimes(3);
  });

  it("nega se UM estourar e devolve a maior espera", async () => {
    h.check
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0 })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 90 })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 300 });
    const result = await enforceLimits(buildOrderLimits({ slug: "loja-a", ip: "1.1.1.1", phone: "11999990001" }));
    expect(result).toEqual({ allowed: false, retryAfterSeconds: 300 });
  });

  it("sem limites a conferir, libera", async () => {
    expect(await enforceLimits([])).toEqual({ allowed: true });
  });
});

describe("as quatro funções protegidas só são chamadas pelo caminho do servidor", () => {
  const SRC = path.resolve(__dirname, "..");
  const PROTECTED = ["create_order", "validate_coupon", "preview_promotion", "is_document_eligible"];
  // PDV legado: segue chamando as RPCs com a sessão do membro enquanto a migration 20261027020000 não existe.
  // A PR do PDV (create_counter_order) remove esta exceção, e só depois a migration 2 pode ser aplicada.
  const LEGACY_COUNTER_PATH = "lib/actions/counterOrders.ts";

  function walk(dir: string, files: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, files);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(full);
    }
    return files;
  }

  it("nenhum código chama .rpc() direto nelas (nem o navegador): tudo passa por callPublicRpc", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (path.relative(SRC, file) === LEGACY_COUNTER_PATH) continue;
      const source = fs.readFileSync(file, "utf8");
      for (const fn of PROTECTED) {
        if (new RegExp(`\\.rpc\\(\\s*["'\`]${fn}["'\`]`).test(source)) offenders.push(`${path.relative(SRC, file)} -> ${fn}`);
      }
    }
    expect(offenders).toEqual([]);
  }, 30000);

  it("nenhum componente de cliente importa publicRpc", () => {
    const offenders = walk(SRC).filter((f) => {
      const s = fs.readFileSync(f, "utf8");
      return /^\s*["']use client["']/.test(s) && /from\s+["'][^"']*publicRpc["']/.test(s);
    });
    expect(offenders).toEqual([]);
  }, 30000);
});
