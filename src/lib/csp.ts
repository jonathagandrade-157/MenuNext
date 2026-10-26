/**
 * Content-Security-Policy do MenuNext. Entra em modo SÓ RELATÓRIO (Content-Security-Policy-Report-Only):
 * o navegador NÃO bloqueia nada, apenas avisa /api/csp-report quando algo fugiria da política. Depois de
 * alguns dias sem violações legítimas, a mesma política passa a valer de verdade (trocar o nome do cabeçalho
 * em next.config.ts) e, em seguida, os 'unsafe-inline' dão lugar a nonce.
 *
 * Origens usadas pelo navegador: o próprio site; Supabase (API, Realtime e imagens do Storage); ViaCEP
 * (busca de endereço no checkout); Sentry (envio de erros). Pagamento (Asaas/Mercado Pago) e WhatsApp são
 * apenas links/redirecionamentos, não carregam nada dentro das páginas.
 */

export const CSP_REPORT_PATH = "/api/csp-report";

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function buildContentSecurityPolicy(options: { supabaseUrl?: string; isDev?: boolean } = {}): string {
  const supabaseHost = hostOf(options.supabaseUrl);
  const supabaseHttp = supabaseHost ? [`https://${supabaseHost}`] : ["https://*.supabase.co"];
  const supabaseWs = supabaseHost ? [`wss://${supabaseHost}`] : ["wss://*.supabase.co"];

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Next.js injeta scripts inline para hidratar a página; nonce virá numa etapa posterior.
    "script-src": ["'self'", "'unsafe-inline'", ...(options.isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...supabaseHttp],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      ...supabaseHttp,
      ...supabaseWs,
      "https://viacep.com.br",
      "https://*.ingest.sentry.io",
      "https://*.ingest.us.sentry.io",
      "https://*.ingest.de.sentry.io",
    ],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "media-src": ["'self'", "data:", "blob:", ...supabaseHttp],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  return [...Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`), `report-uri ${CSP_REPORT_PATH}`].join("; ");
}

export type CspViolationSummary = {
  directive: string;
  blocked: string;
  page: string;
  source: string | null;
};

const MAX_FIELD = 200;
const clip = (v: unknown): string => (typeof v === "string" ? v.slice(0, MAX_FIELD) : "");

/** Resume um relatório de violação (formato clássico {"csp-report": {...}} ou da Reporting API [{body: {...}}]).
 * Devolve null se não parecer um relatório; nunca repete o texto bruto inteiro (limita cada campo). */
export function summarizeCspReport(payload: unknown): CspViolationSummary | null {
  const first = Array.isArray(payload) ? payload[0] : payload;
  if (!first || typeof first !== "object") return null;
  const obj = first as Record<string, unknown>;
  const body = (obj["csp-report"] ?? obj.body ?? obj) as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object") return null;

  const directive = clip(body["effective-directive"] ?? body.effectiveDirective ?? body["violated-directive"] ?? body.violatedDirective);
  if (!directive) return null;
  const sourceFile = clip(body["source-file"] ?? body.sourceFile);
  return {
    directive,
    blocked: clip(body["blocked-uri"] ?? body.blockedURL ?? body.blockedUri),
    page: clip(body["document-uri"] ?? body.documentURL ?? body.documentUri),
    source: sourceFile || null,
  };
}
