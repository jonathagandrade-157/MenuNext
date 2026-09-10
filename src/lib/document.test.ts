import { describe, expect, it } from "vitest";
import { isValidCNPJ, isValidCPF, isValidDocument, maskDocument, normalizeDocument } from "./document";

// CPF/CNPJ de teste conhecidos e amplamente usados como referência pública
// (não pertencem a nenhuma pessoa/empresa real, mesmo padrão usado em
// documentação e QA de outros sistemas brasileiros).
const VALID_CPF = "11144477735";
const VALID_CNPJ = "11222333000181";

describe("normalizeDocument", () => {
  it("remove pontuação de CPF mascarado", () => {
    expect(normalizeDocument("123.456.789-00")).toBe("12345678900");
  });

  it("remove pontuação de CNPJ mascarado", () => {
    expect(normalizeDocument("12.345.678/0001-00")).toBe("12345678000100");
  });

  it("mantém string já normalizada inalterada", () => {
    expect(normalizeDocument(VALID_CPF)).toBe(VALID_CPF);
  });
});

describe("maskDocument", () => {
  it("aplica máscara de CPF a 11 dígitos", () => {
    expect(maskDocument(VALID_CPF)).toBe("111.444.777-35");
  });

  it("aplica máscara de CNPJ a 14 dígitos", () => {
    expect(maskDocument(VALID_CNPJ)).toBe("11.222.333/0001-81");
  });

  it("não quebra com entrada parcial (usuário ainda digitando)", () => {
    expect(maskDocument("111")).toBe("111");
    expect(maskDocument("111444777")).toBe("111.444.777");
  });
});

describe("isValidCPF — TESTE 1 (válido) e TESTE 2 (inválido)", () => {
  it("aceita CPF válido", () => {
    expect(isValidCPF(VALID_CPF)).toBe(true);
  });

  it("rejeita CPF com dígito verificador incorreto", () => {
    expect(isValidCPF("11144477736")).toBe(false);
  });

  it("rejeita sequência de dígitos repetidos (ex.: 111.111.111-11)", () => {
    expect(isValidCPF("11111111111")).toBe(false);
    expect(isValidCPF("00000000000")).toBe(false);
  });

  it("rejeita CPF com quantidade errada de dígitos", () => {
    expect(isValidCPF("123456789")).toBe(false);
    expect(isValidCPF("123456789012")).toBe(false);
  });
});

describe("isValidCNPJ — TESTE 3 (válido) e TESTE 4 (inválido)", () => {
  it("aceita CNPJ válido", () => {
    expect(isValidCNPJ(VALID_CNPJ)).toBe(true);
  });

  it("rejeita CNPJ com dígito verificador incorreto", () => {
    expect(isValidCNPJ("11222333000182")).toBe(false);
  });

  it("rejeita sequência de dígitos repetidos", () => {
    expect(isValidCNPJ("11111111111111")).toBe(false);
  });

  it("rejeita CNPJ com quantidade errada de dígitos", () => {
    expect(isValidCNPJ("1122233300018")).toBe(false);
  });
});

describe("isValidDocument — aceita CPF ou CNPJ, com ou sem máscara", () => {
  it("TESTE 5: CPF mascarado é normalizado e validado corretamente", () => {
    expect(isValidDocument("111.444.777-35")).toBe(true);
  });

  it("TESTE 6: CNPJ mascarado é normalizado e validado corretamente", () => {
    expect(isValidDocument("11.222.333/0001-81")).toBe(true);
  });

  it("rejeita CPF mascarado inválido", () => {
    expect(isValidDocument("111.444.777-36")).toBe(false);
  });

  it("rejeita CNPJ mascarado inválido", () => {
    expect(isValidDocument("11.222.333/0001-82")).toBe(false);
  });

  it("rejeita qualquer sequência que não seja 11 ou 14 dígitos", () => {
    expect(isValidDocument("123")).toBe(false);
    expect(isValidDocument("123456789012345")).toBe(false);
  });

  it("não aceita apenas 'qualquer sequência' de 11 ou 14 números sem dígito verificador válido", () => {
    // 11 e 14 dígitos "aleatórios" que não formam um CPF/CNPJ real
    expect(isValidDocument("12345678901")).toBe(false);
    expect(isValidDocument("12345678901234")).toBe(false);
  });
});
