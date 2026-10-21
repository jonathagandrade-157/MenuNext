import { describe, expect, it } from "vitest";
import { safeEqual } from "./safeEqual";

describe("safeEqual", () => {
  it("iguais, diferentes, tamanhos distintos e caixa", () => {
    expect(safeEqual("segredo-123", "segredo-123")).toBe(true);
    expect(safeEqual("segredo-123", "segredo-124")).toBe(false);
    expect(safeEqual("segredo-123", "segredo-1234")).toBe(false);
    expect(safeEqual("ABC", "abc")).toBe(false);
  });

  it("valores ausentes nunca são iguais, nem entre si", () => {
    expect(safeEqual(null, null)).toBe(false);
    expect(safeEqual(undefined, undefined)).toBe(false);
    expect(safeEqual("", null)).toBe(false);
    expect(safeEqual("x", undefined)).toBe(false);
  });

  it("string vazia só é igual a string vazia (quem usa deve rejeitar segredo vazio antes)", () => {
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("", "x")).toBe(false);
  });
});
