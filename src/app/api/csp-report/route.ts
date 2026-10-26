import { summarizeCspReport } from "@/lib/csp";

/**
 * Recebe os avisos de violação da Content-Security-Policy (modo só relatório). Público por natureza (é o
 * navegador do visitante que envia), então: corpo pequeno, nada é gravado no banco, só uma linha curta no
 * log da plataforma com os campos já limitados. Sempre responde 204 — o navegador não precisa de mais nada.
 */
const MAX_BODY_BYTES = 8 * 1024;

export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text.length > 0 && text.length <= MAX_BODY_BYTES) {
      const summary = summarizeCspReport(JSON.parse(text));
      if (summary) {
        console.warn(`[csp] ${summary.directive} bloquearia ${summary.blocked || "(inline)"} em ${summary.page}${summary.source ? ` (origem ${summary.source})` : ""}`);
      }
    }
  } catch {
    // relatório malformado: ignora
  }
  return new Response(null, { status: 204 });
}
