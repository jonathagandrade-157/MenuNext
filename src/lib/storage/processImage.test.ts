import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { COVER_MAX_WIDTH, SQUARE_PRODUCT_SIZE, toCompressedWebp, toSquareWebp } from "./processImage";

// Foto sintética com ruído (comprime mal, como uma foto real) para testar o ganho de tamanho.
async function noisyJpeg(width: number, height: number): Promise<Blob> {
  const raw = Buffer.alloc(width * height * 3);
  let seed = 12345;
  for (let i = 0; i < raw.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = (seed >> 16) & 0xff;
  }
  const jpeg = await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
  return new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" });
}

async function meta(bytes: Uint8Array) {
  const m = await sharp(Buffer.from(bytes)).metadata();
  return { format: m.format, width: m.width, height: m.height, exif: m.exif };
}

describe("toSquareWebp", () => {
  it("recorta foto horizontal para 1:1 no menor lado e converte para WebP", async () => {
    const out = await toSquareWebp(await noisyJpeg(700, 500));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const m = await meta(out.bytes);
    expect(m.format).toBe("webp");
    expect(m.width).toBe(500);
    expect(m.height).toBe(500);
    expect(out.mimeType).toBe("image/webp");
    expect(out.extension).toBe("webp");
  });

  it("recorta foto vertical para 1:1", async () => {
    const out = await toSquareWebp(await noisyJpeg(400, 900));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const m = await meta(out.bytes);
    expect(m.width).toBe(400);
    expect(m.height).toBe(400);
  });

  it("limita foto grande a 800 px e fica muito menor que o original", async () => {
    const input = await noisyJpeg(2400, 1800);
    const out = await toSquareWebp(input);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const m = await meta(out.bytes);
    expect(m.width).toBe(SQUARE_PRODUCT_SIZE);
    expect(m.height).toBe(SQUARE_PRODUCT_SIZE);
    expect(out.bytes.byteLength).toBeLessThan(input.size / 4);
  });

  it("nunca amplia: foto pequena fica quadrada no tamanho que tem", async () => {
    const out = await toSquareWebp(await noisyJpeg(300, 200));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const m = await meta(out.bytes);
    expect(m.width).toBe(200);
    expect(m.height).toBe(200);
  });

  it("respeita o lado máximo informado (logo)", async () => {
    const out = await toSquareWebp(await noisyJpeg(1500, 1000), { maxSide: 512 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const m = await meta(out.bytes);
    expect(m.width).toBe(512);
    expect(m.height).toBe(512);
  });

  it("aplica a orientação EXIF e remove os metadados", async () => {
    // 600x400 marcada como rotacionada 90° vira 400x600 e, depois do recorte, 400x400.
    const rotated = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#cc4400" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = await toSquareWebp(new Blob([new Uint8Array(rotated)], { type: "image/jpeg" }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const m = await meta(out.bytes);
    expect(m.width).toBe(400);
    expect(m.height).toBe(400);
    expect(m.exif).toBeUndefined();
  });

  it("devolve erro amigável para conteúdo que não é imagem", async () => {
    const out = await toSquareWebp(new Blob(["isto não é uma imagem"], { type: "image/jpeg" }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/processar a imagem/);
  });
});

describe("toCompressedWebp", () => {
  it("mantém a proporção da capa, limita a largura e comprime", async () => {
    const input = await noisyJpeg(3200, 1200);
    const out = await toCompressedWebp(input);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const m = await meta(out.bytes);
    expect(m.format).toBe("webp");
    expect(m.width).toBe(COVER_MAX_WIDTH);
    expect(m.height).toBe(600);
    expect(out.bytes.byteLength).toBeLessThan(input.size / 3);
  });
});
