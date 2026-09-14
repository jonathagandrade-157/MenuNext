import { describe, expect, it } from "vitest";
import {
  getPrimaryProductImage,
  isPrimaryProductImage,
  nextProductImageDisplayOrder,
  sortProductImagesByDisplayOrder,
  stepsToPromoteToPrimary,
  type ProductImageOrder,
} from "./productImages";

describe("nextProductImageDisplayOrder", () => {
  it("produto sem imagem: primeira foto vira slot 1 (principal)", () => {
    expect(nextProductImageDisplayOrder([])).toBe(1);
  });

  it("produto com 1 imagem: próxima vai para o slot 2", () => {
    expect(nextProductImageDisplayOrder([1])).toBe(2);
  });

  it("produto com 2 imagens: próxima vai para o slot 3", () => {
    expect(nextProductImageDisplayOrder([1, 2])).toBe(3);
  });

  it("produto com 5 imagens (máximo): não permite 6ª imagem", () => {
    expect(nextProductImageDisplayOrder([1, 2, 3, 4, 5])).toBeNull();
  });

  it("BUG CORRIGIDO: buraco deixado pela exclusão da principal NUNCA é reocupado por um upload seguinte", () => {
    // Slots 2 e 3 existem (slot 1, a principal, foi excluída) — a próxima
    // imagem deve ir para o slot 4, nunca reocupar o slot 1 e virar
    // principal sem o lojista pedir.
    expect(nextProductImageDisplayOrder([2, 3])).toBe(4);
  });

  it("ordem de entrada no array não importa — sempre usa o maior valor", () => {
    expect(nextProductImageDisplayOrder([3, 1, 2])).toBe(4);
  });
});

function image(id: string, display_order: number): ProductImageOrder {
  return { id, display_order };
}

describe("sortProductImagesByDisplayOrder / getPrimaryProductImage", () => {
  it("produto sem imagem: sem principal", () => {
    expect(getPrimaryProductImage([])).toBeNull();
  });

  it("produto com 1 imagem: ela é a principal", () => {
    const images = [image("a", 1)];
    expect(getPrimaryProductImage(images)?.id).toBe("a");
  });

  it("ordena por display_order independente da ordem de entrada", () => {
    const images = [image("c", 3), image("a", 1), image("b", 2)];
    expect(sortProductImagesByDisplayOrder(images).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("produto com 5 imagens: a de menor display_order é a principal", () => {
    const images = [image("e", 5), image("a", 1), image("c", 3), image("b", 2), image("d", 4)];
    expect(getPrimaryProductImage(images)?.id).toBe("a");
  });

  it("EXCLUSÃO DA PRINCIPAL: ao remover a de menor display_order, a próxima assume automaticamente", () => {
    const images = [image("a", 1), image("b", 2), image("c", 3)];
    const afterDeletingPrimary = images.filter((i) => i.id !== "a");
    expect(getPrimaryProductImage(afterDeletingPrimary)?.id).toBe("b");
  });
});

describe("isPrimaryProductImage", () => {
  it("identifica corretamente a principal e as secundárias", () => {
    const images = [image("a", 1), image("b", 2)];
    expect(isPrimaryProductImage(image("a", 1), images)).toBe(true);
    expect(isPrimaryProductImage(image("b", 2), images)).toBe(false);
  });
});

describe("stepsToPromoteToPrimary — DEFINIR COMO PRINCIPAL", () => {
  it("imagem já principal: 0 passos", () => {
    const images = [image("a", 1), image("b", 2), image("c", 3)];
    expect(stepsToPromoteToPrimary(images, "a")).toBe(0);
  });

  it("segunda imagem: 1 passo (uma troca com a vizinha)", () => {
    const images = [image("a", 1), image("b", 2), image("c", 3)];
    expect(stepsToPromoteToPrimary(images, "b")).toBe(1);
  });

  it("última de 5 imagens: 4 passos", () => {
    const images = [image("a", 1), image("b", 2), image("c", 3), image("d", 4), image("e", 5)];
    expect(stepsToPromoteToPrimary(images, "e")).toBe(4);
  });

  it("imagem inexistente: 0 passos (não deve mover nada)", () => {
    const images = [image("a", 1), image("b", 2)];
    expect(stepsToPromoteToPrimary(images, "inexistente")).toBe(0);
  });
});
