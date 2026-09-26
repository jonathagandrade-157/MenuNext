import { describe, expect, it } from "vitest";
import { crc16, generatePixBrCode } from "./pix";

describe("crc16", () => {
  it("bate com o vetor de teste padrão do CRC-16/CCITT-FALSE", () => {
    expect(crc16("123456789")).toBe("29B1");
  });
});

describe("generatePixBrCode", () => {
  it("gera um payload EMV bem formado, terminando com o CRC do próprio payload", () => {
    const brCode = generatePixBrCode({
      pixKey: "11999999999",
      merchantName: "Next Burger Express",
      merchantCity: "São Paulo",
    });

    expect(brCode.startsWith("000201")).toBe(true);
    expect(brCode).toContain("br.gov.bcb.pix");
    expect(brCode).toContain("11999999999");

    const withoutCrc = brCode.slice(0, -4);
    const crc = brCode.slice(-4);
    expect(crc).toBe(crc16(withoutCrc));
  });

  it("remove acentos do nome/cidade (EMV só aceita Latin básico)", () => {
    const brCode = generatePixBrCode({ pixKey: "chave-aleatoria", merchantName: "João Confeitaria", merchantCity: "São Paulo" });
    expect(brCode).toContain("Joao Confeitaria");
    expect(brCode).toContain("Sao Paulo");
  });

  it("trunca nome e cidade nos limites do EMV (25 e 15 caracteres)", () => {
    const brCode = generatePixBrCode({
      pixKey: "chave",
      merchantName: "Um Nome de Restaurante Muito Comprido Mesmo",
      merchantCity: "Uma Cidade Com Nome Muito Longo",
    });
    // Campo 59 (nome): tamanho declarado nos 2 dígitos após "59".
    const nameFieldStart = brCode.indexOf("59");
    const nameLength = Number(brCode.slice(nameFieldStart + 2, nameFieldStart + 4));
    expect(nameLength).toBeLessThanOrEqual(25);
  });
});
