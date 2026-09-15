import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
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
// stack traces legíveis, não para o instrumentation em si.
export default withSentryConfig(nextConfig, {
  org: "jonatha-study",
  project: "menunext",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
});
