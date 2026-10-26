import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { buildContentSecurityPolicy } from "./src/lib/csp";

// Cabeçalhos de segurança em todas as páginas. Só os que não arriscam quebrar a loja: impedir que o
// painel/loja sejam embutidos em outro site (clickjacking), que o navegador "adivinhe" tipos de arquivo,
// vazar URL completa para terceiros e pedir câmera/microfone/localização/pagamento do navegador (o app não usa).
// Content-Security-Policy: vale de verdade em produção; em desenvolvimento fica só em relatório (o HMR do Next
// usa conexões que ela bloquearia). Violações chegam em /api/csp-report (linha "[csp]" no log da Vercel).
// (HSTS já é enviado pela Vercel.)
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  {
    key: process.env.NODE_ENV === "production" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only",
    value: buildContentSecurityPolicy({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      isDev: process.env.NODE_ENV !== "production",
    }),
  },
];

const nextConfig: NextConfig = {
  // não anuncia o framework em cada resposta
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  experimental: {
    serverActions: {
      // Padrão do Next.js é 1 MB — insuficiente para createProductAction,
      // que envia até 5 imagens de 5 MB cada (MAX_PRODUCT_IMAGES/
      // MAX_IMAGE_SIZE_BYTES em src/lib/storage/assets.ts) na mesma
      // requisição multipart do produto. 30mb cobre esse pior caso (25 MB)
      // com folga para o overhead de multipart/form-data.
      bodySizeLimit: "30mb",
    },
  },
};

// JON-21 — projeto Sentry "menunext" (org jonatha-study), separado do
// projeto do Vexo. authToken vem de SENTRY_AUTH_TOKEN só se existir: sem
// ela, o upload de source maps é pulado (sem quebrar o build), e a
// captura de erros continua funcionando normalmente — authToken é só para
// stack traces legíveis, não para o instrumentation em si. silent:false
// (padrão) para o build log mostrar se o upload de source maps rodou.
export default withSentryConfig(nextConfig, {
  org: "jonatha-study",
  project: "menunext",
  authToken: process.env.SENTRY_AUTH_TOKEN,
});
