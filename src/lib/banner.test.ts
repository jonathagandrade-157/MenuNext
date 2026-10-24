import { describe, expect, it } from "vitest";
import { BANNER_MESSAGE_MAX, FEATURED_PRODUCTS_LIMIT, pickFeaturedProducts, validateBanner } from "./banner";

describe("validateBanner", () => {
  it("normaliza espaços e aceita texto válido", () => {
    expect(validateBanner("  Terça do   Burger:\n 20% off  ", true)).toEqual({ ok: true, message: "Terça do Burger: 20% off" });
  });

  it("não deixa ligar o banner sem texto", () => {
    expect(validateBanner("   ", true)).toEqual({ ok: false, error: "Escreva o texto do banner ou desligue-o." });
  });

  it("desligado, o texto pode ficar vazio (o dono só apaga o aviso)", () => {
    expect(validateBanner("", false)).toEqual({ ok: true, message: "" });
  });

  it("respeita o limite do banco: 140 passa, 141 não", () => {
    expect(validateBanner("x".repeat(BANNER_MESSAGE_MAX), true).ok).toBe(true);
    const r = validateBanner("x".repeat(BANNER_MESSAGE_MAX + 1), true);
    expect(r.ok).toBe(false);
  });
});

describe("pickFeaturedProducts", () => {
  const p = (name: string, is_featured: boolean, is_available = true) => ({ name, is_featured, is_available });

  it("só marcados e disponíveis, na ordem recebida", () => {
    const list = [p("a", true), p("b", false), p("c", true, false), p("d", true)];
    expect(pickFeaturedProducts(list).map((x) => x.name)).toEqual(["a", "d"]);
  });

  it("respeita o limite", () => {
    const many = Array.from({ length: FEATURED_PRODUCTS_LIMIT + 3 }, (_, i) => p(`p${i}`, true));
    expect(pickFeaturedProducts(many)).toHaveLength(FEATURED_PRODUCTS_LIMIT);
    expect(pickFeaturedProducts(many, 2)).toHaveLength(2);
  });

  it("sem destaque devolve vazio", () => {
    expect(pickFeaturedProducts([p("a", false)])).toEqual([]);
  });
});
