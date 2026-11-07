import { describe, expect, it } from "vitest";
import { friendlyVariantError, getVariants, groupByProduct, isVariantId, validateVariantInput } from "./variants";

describe("validateVariantInput", () => {
  it("normaliza nome e centavos", () => {
    expect(validateVariantInput("  Grande ", 55.555)).toEqual({ ok: true, value: { name: "Grande", price: 55.56 } });
  });
  it("recusa nome vazio/longo e preço zero, negativo, nulo, NaN ou enorme", () => {
    expect(validateVariantInput("  ", 5).ok).toBe(false);
    expect(validateVariantInput("x".repeat(61), 5).ok).toBe(false);
    for (const p of [0, -1, null, NaN, Infinity, 100000]) expect(validateVariantInput("ok", p as number | null).ok, String(p)).toBe(false);
    expect(validateVariantInput(undefined, 5).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("UUID", () => {
    expect(isVariantId("0b0e7c8e-7a47-4bd5-9f55-5f2d6a0f3c11")).toBe(true);
    expect(isVariantId("x; drop")).toBe(false);
  });
  it("erros amigáveis", () => {
    expect(friendlyVariantError("variant_duplicate")).toMatch(/Já existe/);
    expect(friendlyVariantError("too_many_variants")).toMatch(/20/);
    expect(friendlyVariantError("boom")).toBe("Não foi possível concluir agora. Tente novamente.");
  });
  it("agrupa por produto preservando a ordem", () => {
    const v = (id: string, productId: string) => ({ id, productId, name: id, price: 1, isAvailable: true, displayOrder: 0 });
    const g = groupByProduct([v("a", "p1"), v("b", "p2"), v("c", "p1")]);
    expect(g.get("p1")!.map((x) => x.id)).toEqual(["a", "c"]);
    expect(g.get("p2")!.map((x) => x.id)).toEqual(["b"]);
  });
  it("getVariants: indisponível sem a migration, propaga outros erros", async () => {
    const make = (error: unknown, data: unknown = null) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order"]) chain[m] = () => chain;
      chain.limit = async () => ({ data, error });
      return { from: () => chain } as never;
    };
    expect(await getVariants(make({ code: "PGRST205", message: "x" }), "r")).toEqual({ available: false, variants: [] });
    await expect(getVariants(make({ code: "XX000", message: "boom" }), "r")).rejects.toBeTruthy();
    const ok = await getVariants(make(null, [{ id: "1", product_id: "p", name: "G", price: "12.5", is_available: false, display_order: 2 }]), "r");
    expect(ok.variants[0]).toEqual({ id: "1", productId: "p", name: "G", price: 12.5, isAvailable: false, displayOrder: 2 });
  });
});
