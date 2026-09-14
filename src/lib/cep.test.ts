import { describe, expect, it } from "vitest";
import { cepDigits, formatCepInput, isCompleteCep } from "./cep";

describe("formatCepInput", () => {
  it("formata dígitos como 00000-000 conforme o usuário digita", () => {
    expect(formatCepInput("0")).toBe("0");
    expect(formatCepInput("01310")).toBe("01310");
    expect(formatCepInput("01310100")).toBe("01310-100");
  });

  it("ignora caracteres não numéricos", () => {
    expect(formatCepInput("01310-100")).toBe("01310-100");
    expect(formatCepInput("abc01310100xyz")).toBe("01310-100");
  });

  it("nunca ultrapassa 8 dígitos", () => {
    expect(formatCepInput("013101009999")).toBe("01310-100");
  });
});

describe("cepDigits", () => {
  it("retorna só os dígitos, sem máscara", () => {
    expect(cepDigits("01310-100")).toBe("01310100");
  });
});

describe("isCompleteCep", () => {
  it("verdadeiro só com exatamente 8 dígitos", () => {
    expect(isCompleteCep("01310-100")).toBe(true);
    expect(isCompleteCep("01310100")).toBe(true);
    expect(isCompleteCep("01310")).toBe(false);
    expect(isCompleteCep("")).toBe(false);
  });
});
