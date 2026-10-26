import { describe, expect, it } from "vitest";
import { CSP_REPORT_PATH, buildContentSecurityPolicy, summarizeCspReport } from "./csp";

describe("buildContentSecurityPolicy", () => {
  const csp = buildContentSecurityPolicy({ supabaseUrl: "https://abc123.supabase.co" });
  const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

  it("fecha o essencial: sem iframe externo, sem plugin, sem <base> externo", () => {
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("base-uri")).toBe("base-uri 'self'");
    // form-action fica de fora de propósito: protege pouco e o navegador o aplica também aos redirecionamentos
    // de formulário (risco com a ida ao pagamento).
    expect(directive("form-action")).toBe("");
    expect(directive("default-src")).toBe("default-src 'self'");
  });

  it("libera só as origens que o navegador realmente usa", () => {
    expect(directive("connect-src")).toContain("https://abc123.supabase.co");
    expect(directive("connect-src")).toContain("wss://abc123.supabase.co");
    expect(directive("connect-src")).toContain("https://viacep.com.br");
    expect(directive("img-src")).toContain("https://abc123.supabase.co");
  });

  it("nunca usa curinga total nem libera eval em produção", () => {
    expect(csp).not.toMatch(/\s\*(\s|;|$)/);
    expect(directive("script-src")).not.toContain("unsafe-eval");
    expect(buildContentSecurityPolicy({ isDev: true })).toContain("'unsafe-eval'");
  });

  it("sem URL do Supabase cai para o domínio genérico em vez de abrir tudo", () => {
    const generic = buildContentSecurityPolicy({});
    expect(generic).toContain("https://*.supabase.co");
    expect(generic).not.toContain("connect-src 'self' *");
  });

  it("aponta as violações para o endpoint de relatório", () => {
    expect(csp.endsWith(`report-uri ${CSP_REPORT_PATH}`)).toBe(true);
  });
});

describe("summarizeCspReport", () => {
  it("lê o formato clássico (report-uri)", () => {
    const s = summarizeCspReport({
      "csp-report": { "effective-directive": "img-src", "blocked-uri": "https://x.test/a.png", "document-uri": "https://site/loja/a", "source-file": "https://site/app.js" },
    });
    expect(s).toEqual({ directive: "img-src", blocked: "https://x.test/a.png", page: "https://site/loja/a", source: "https://site/app.js" });
  });

  it("lê o formato da Reporting API (lista com body)", () => {
    const s = summarizeCspReport([{ type: "csp-violation", body: { effectiveDirective: "script-src", blockedURL: "inline", documentURL: "https://site/" } }]);
    expect(s).toMatchObject({ directive: "script-src", blocked: "inline", page: "https://site/", source: null });
  });

  it("recusa lixo e limita o tamanho de cada campo", () => {
    expect(summarizeCspReport(null)).toBeNull();
    expect(summarizeCspReport("texto")).toBeNull();
    expect(summarizeCspReport({ foo: 1 })).toBeNull();
    const big = summarizeCspReport({ "csp-report": { "effective-directive": "img-src", "blocked-uri": "x".repeat(5000) } });
    expect(big?.blocked.length).toBe(200);
  });
});
