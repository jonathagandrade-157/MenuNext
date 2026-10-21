import { describe, expect, it } from "vitest";
import { buttonContrast, contrastLevel, contrastRatio, dominantColors, hexToRgb, isHexColor } from "./colorContrast";

const pixels = (...groups: [string, number][]): number[] => {
  const out: number[] = [];
  for (const [hex, times] of groups) {
    const [r, g, b] = hexToRgb(hex);
    for (let i = 0; i < times; i++) out.push(r, g, b, 255);
  }
  return out;
};

describe("contraste", () => {
  it("preto sobre branco é 21:1 e igual sobre igual é 1:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("a cor padrão da marca passa com folga no botão de texto branco", () => {
    const { ratio, level } = buttonContrast("#ab2f00");
    expect(ratio).toBeGreaterThan(6);
    expect(level).toBe("AA");
  });

  it("amarelo claro com texto branco reprova", () => {
    expect(buttonContrast("#ffe066").level).toBe("fail");
  });

  it("classifica os limites do WCAG", () => {
    expect(contrastLevel(7)).toBe("AAA");
    expect(contrastLevel(4.5)).toBe("AA");
    expect(contrastLevel(3)).toBe("AA-large");
    expect(contrastLevel(2.99)).toBe("fail");
  });

  it("valida hex de 6 dígitos", () => {
    expect(isHexColor("#ab2f00")).toBe(true);
    expect(isHexColor("ab2f00")).toBe(false);
    expect(isHexColor("#fff")).toBe(false);
  });
});

describe("dominantColors", () => {
  it("devolve as cores da marca e ignora fundo branco, preto e transparente", () => {
    const data = pixels(["#ffffff", 500], ["#000000", 200], ["#e8552a", 120], ["#1f3a93", 60]);
    // pixels transparentes não contam
    data.push(10, 200, 10, 0, 10, 200, 10, 0);
    const colors = dominantColors(data);
    expect(colors).toHaveLength(2);
    const [first, second] = colors.map(hexToRgb);
    expect(first[0]).toBeGreaterThan(200); // laranja
    expect(second[2]).toBeGreaterThan(120); // azul
  });

  it("junta tons muito parecidos numa só sugestão", () => {
    const colors = dominantColors(pixels(["#e8552a", 100], ["#e9562b", 90], ["#e7542a", 80]));
    expect(colors).toHaveLength(1);
  });

  it("imagem sem cor aproveitável (só branco/preto) não sugere nada", () => {
    expect(dominantColors(pixels(["#ffffff", 100], ["#000000", 100]))).toEqual([]);
  });

  it("respeita o limite de cores pedido", () => {
    const colors = dominantColors(pixels(["#ff0000", 50], ["#00aa00", 40], ["#0000ff", 30], ["#ffaa00", 20]), 2);
    expect(colors).toHaveLength(2);
  });
});

describe("dominantColors com cinzas", () => {
  it("coloca a cor da marca antes de cinzas mais frequentes", () => {
    const data = pixels(["#999999", 300], ["#c8cad6", 200], ["#e8552a", 60]);
    const [first] = dominantColors(data);
    expect(hexToRgb(first)[0]).toBeGreaterThan(200);
    expect(hexToRgb(first)[2]).toBeLessThan(90);
  });
});
