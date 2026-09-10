import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_SIZE_BYTES,
  MAX_PRODUCT_IMAGES,
  bannerPath,
  productImagePath,
  restaurantCoverPath,
  restaurantLogoPath,
  sniffImageMimeType,
  validateImageFile,
} from "./assets";

const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01];
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d];
const WEBP_HEADER = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];
const SVG_BYTES = Array.from(new TextEncoder().encode("<svg xmlns='x'><script>alert(1)</script></svg>"));
const HTML_BYTES = Array.from(new TextEncoder().encode("<!DOCTYPE html><html><body>hi</body></html>"));

function makeFile(bytes: number[], type: string, name = "arquivo"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("sniffImageMimeType", () => {
  it("reconhece JPEG pelos magic bytes", () => {
    expect(sniffImageMimeType(new Uint8Array(JPEG_HEADER))).toBe("image/jpeg");
  });
  it("reconhece PNG pelos magic bytes", () => {
    expect(sniffImageMimeType(new Uint8Array(PNG_HEADER))).toBe("image/png");
  });
  it("reconhece WebP pelos magic bytes (RIFF....WEBP)", () => {
    expect(sniffImageMimeType(new Uint8Array(WEBP_HEADER))).toBe("image/webp");
  });
  it("não reconhece SVG (é texto XML, não bate com nenhuma assinatura binária)", () => {
    expect(sniffImageMimeType(new Uint8Array(SVG_BYTES))).toBeNull();
  });
  it("não reconhece HTML", () => {
    expect(sniffImageMimeType(new Uint8Array(HTML_BYTES))).toBeNull();
  });
});

describe("validateImageFile — TESTE 1 (upload válido) e TESTE 2 (MIME inválido)", () => {
  it("TESTE 1: aceita um JPEG real, íntegro (magic bytes + MIME batendo)", async () => {
    const file = makeFile(JPEG_HEADER, "image/jpeg");
    const result = await validateImageFile(file);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.extension).toBe("jpg");
  });

  it("TESTE 1b: aceita PNG e WebP reais", async () => {
    expect((await validateImageFile(makeFile(PNG_HEADER, "image/png"))).ok).toBe(true);
    expect((await validateImageFile(makeFile(WEBP_HEADER, "image/webp"))).ok).toBe(true);
  });

  it("TESTE 2: rejeita MIME não suportado (ex.: image/svg+xml)", async () => {
    const file = makeFile(SVG_BYTES, "image/svg+xml");
    const result = await validateImageFile(file);
    expect(result.ok).toBe(false);
  });

  it("rejeita SVG mesmo se o autor disser que é JPEG (spoof de Content-Type)", async () => {
    const file = makeFile(SVG_BYTES, "image/jpeg");
    const result = await validateImageFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/não corresponde a uma imagem válida/);
  });

  it("rejeita HTML disfarçado de imagem", async () => {
    const file = makeFile(HTML_BYTES, "image/png");
    const result = await validateImageFile(file);
    expect(result.ok).toBe(false);
  });

  it("rejeita quando o MIME declarado não bate com o conteúdo real (PNG marcado como JPEG)", async () => {
    const file = makeFile(PNG_HEADER, "image/jpeg");
    const result = await validateImageFile(file);
    expect(result.ok).toBe(false);
  });

  it("TESTE 3: rejeita arquivo acima de 5 MB", async () => {
    const bigBytes = new Uint8Array(MAX_IMAGE_SIZE_BYTES + 1);
    bigBytes.set(JPEG_HEADER);
    const file = new File([bigBytes], "grande.jpg", { type: "image/jpeg" });
    const result = await validateImageFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/5 MB/);
  });

  it("aceita arquivo exatamente no limite de 5 MB", async () => {
    const bytes = new Uint8Array(MAX_IMAGE_SIZE_BYTES);
    bytes.set(JPEG_HEADER);
    const file = new File([bytes], "limite.jpg", { type: "image/jpeg" });
    const result = await validateImageFile(file);
    expect(result.ok).toBe(true);
  });

  it("rejeita arquivo vazio", async () => {
    const file = new File([], "vazio.jpg", { type: "image/jpeg" });
    const result = await validateImageFile(file);
    expect(result.ok).toBe(false);
  });
});

describe("path builders — TESTE 10 (path sempre contém o restaurant_id correto)", () => {
  const restaurantId = "11111111-1111-1111-1111-111111111111";
  const productId = "22222222-2222-2222-2222-222222222222";

  it("logo e capa ficam sob {restaurant_id}/branding/", () => {
    expect(restaurantLogoPath(restaurantId, "jpg")).toBe(`${restaurantId}/branding/logo.jpg`);
    expect(restaurantCoverPath(restaurantId, "webp")).toBe(`${restaurantId}/branding/cover.webp`);
  });

  it("imagem de produto fica sob {restaurant_id}/products/{product_id}/{ordem}.ext", () => {
    expect(productImagePath(restaurantId, productId, 1, "png")).toBe(`${restaurantId}/products/${productId}/1.png`);
    expect(productImagePath(restaurantId, productId, 5, "png")).toBe(`${restaurantId}/products/${productId}/5.png`);
  });

  it("banner fica sob {restaurant_id}/banners/{asset_id}.ext", () => {
    const assetId = "33333333-3333-3333-3333-333333333333";
    expect(bannerPath(restaurantId, assetId, "jpg")).toBe(`${restaurantId}/banners/${assetId}.jpg`);
  });

  it("nenhum path usa o nome original do arquivo", () => {
    const path = productImagePath(restaurantId, productId, 1, "png");
    expect(path).not.toMatch(/original|upload|arquivo/i);
  });

  it("TESTE 6 (limite de 5 imagens): rejeita displayOrder fora de 1..5", () => {
    expect(() => productImagePath(restaurantId, productId, 0, "jpg")).toThrow();
    expect(() => productImagePath(restaurantId, productId, MAX_PRODUCT_IMAGES + 1, "jpg")).toThrow();
  });
});
