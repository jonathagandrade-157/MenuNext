/**
 * Cor da loja: contraste (WCAG 2.x) e paleta sugerida a partir do logo.
 * Tudo puro — sem DOM — para ser testável; o navegador só fornece os pixels.
 */

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

function channelLuminance(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export type ContrastLevel = "AAA" | "AA" | "AA-large" | "fail";

/** Nível WCAG para texto normal (AAA ≥ 7, AA ≥ 4,5); entre 3 e 4,5 só vale para texto grande. */
export function contrastLevel(ratio: number): ContrastLevel {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA-large";
  return "fail";
}

/** Nos botões da loja o texto é branco: este é o contraste que importa. */
export function buttonContrast(color: string): { ratio: number; level: ContrastLevel } {
  const ratio = contrastRatio(color, "#ffffff");
  return { ratio, level: contrastLevel(ratio) };
}

function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function distance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Cores dominantes de uma imagem (pixels RGBA, como em ImageData.data).
 * Ignora transparente, quase branco e quase preto (fundo do logo), agrupa
 * cores parecidas e privilegia bastante as saturadas, que são as da marca.
 */
export function dominantColors(data: Uint8ClampedArray | number[], count = 5): string[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (data[i + 3] < 128) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (min > 235) continue; // quase branco
    if (max < 25) continue; // quase preto
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.n++;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      buckets.set(key, { n: 1, r, g, b });
    }
  }

  const ranked = [...buckets.values()]
    .map((bk) => {
      const avg: [number, number, number] = [bk.r / bk.n, bk.g / bk.n, bk.b / bk.n];
      // Saturação ao quadrado: cinzas (fundo, sombras) quase não pontuam; a cor da marca sobe.
      const sat = saturation(avg[0], avg[1], avg[2]);
      return { avg, score: bk.n * (0.05 + sat * sat) };
    })
    .sort((x, y) => y.score - x.score);

  const picked: [number, number, number][] = [];
  for (const candidate of ranked) {
    if (picked.every((p) => distance(p, candidate.avg) >= 60)) picked.push(candidate.avg);
    if (picked.length >= count) break;
  }
  return picked.map(([r, g, b]) => rgbToHex(r, g, b));
}
