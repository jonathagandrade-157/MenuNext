/**
 * Processamento de imagens antes do upload: toda foto vira WebP, sem
 * metadados (EXIF/GPS), com orientação corrigida e, quando pedido, recorte
 * quadrado 1:1 centralizado. Objetivo: foto sempre quadrada, leve (consome
 * pouco armazenamento e banda) e ainda com boa qualidade visual.
 *
 * Roda no servidor (Server Actions) com `sharp`. A entrada já passou por
 * validateImageFile (tamanho, MIME declarado e magic bytes).
 */

import sharp from "sharp";

export const SQUARE_PRODUCT_SIZE = 800; // lado máximo da foto de produto/combo (px)
export const SQUARE_LOGO_SIZE = 512; // lado máximo do logo (px)
export const COVER_MAX_WIDTH = 1600; // largura máxima da capa (px), mantém a proporção
export const WEBP_QUALITY = 80;

export type ProcessedImage = {
  ok: true;
  bytes: Uint8Array;
  mimeType: "image/webp";
  extension: "webp";
  width: number;
  height: number;
};
export type ProcessImageResult = ProcessedImage | { ok: false; error: string };

const PROCESS_ERROR = "Não foi possível processar a imagem. Envie outro arquivo JPEG, PNG ou WebP.";

/**
 * Recorte 1:1 centralizado. O lado final é o menor lado da imagem limitado a
 * `maxSide` — nunca amplia (foto pequena fica quadrada no tamanho que tem).
 * Escolher o menor lado não depende da rotação EXIF, que só troca largura e
 * altura entre si.
 */
export async function toSquareWebp(
  file: Blob,
  options: { maxSide?: number; quality?: number } = {}
): Promise<ProcessImageResult> {
  const maxSide = options.maxSide ?? SQUARE_PRODUCT_SIZE;
  const quality = options.quality ?? WEBP_QUALITY;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const meta = await sharp(input).metadata();
    if (!meta.width || !meta.height) return { ok: false, error: PROCESS_ERROR };

    const side = Math.min(maxSide, meta.width, meta.height);
    const { data, info } = await sharp(input)
      .rotate()
      .resize(side, side, { fit: "cover", position: "centre" })
      .webp({ quality, effort: 4, smartSubsample: true })
      .toBuffer({ resolveWithObject: true });

    return { ok: true, bytes: new Uint8Array(data), mimeType: "image/webp", extension: "webp", width: info.width, height: info.height };
  } catch {
    return { ok: false, error: PROCESS_ERROR };
  }
}

/** Capa: não recorta (banner largo), só limita a largura e comprime. */
export async function toCompressedWebp(
  file: Blob,
  options: { maxWidth?: number; quality?: number } = {}
): Promise<ProcessImageResult> {
  const maxWidth = options.maxWidth ?? COVER_MAX_WIDTH;
  const quality = options.quality ?? WEBP_QUALITY;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const { data, info } = await sharp(input)
      .rotate()
      .resize({ width: maxWidth, withoutEnlargement: true })
      .webp({ quality, effort: 4, smartSubsample: true })
      .toBuffer({ resolveWithObject: true });

    return { ok: true, bytes: new Uint8Array(data), mimeType: "image/webp", extension: "webp", width: info.width, height: info.height };
  } catch {
    return { ok: false, error: PROCESS_ERROR };
  }
}
