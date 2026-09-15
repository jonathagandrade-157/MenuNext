// Sentry — runtime cliente (browser). Arquivo lido pelo próprio Next.js
// (convenção instrumentation-client.ts), não pelo instrumentation.ts.
//
// Projeto Sentry do MenuNext (JON-21) — separado do projeto do Vexo, que
// tem seu próprio DSN e nunca é usado aqui. O DSN não é um secret (é
// enviado ao navegador em qualquer SDK de erro do cliente, por design —
// ver docs do Sentry), então está seguro deixá-lo aqui como padrão; a env
// var NEXT_PUBLIC_SENTRY_DSN (se configurada na Vercel) tem prioridade,
// pra permitir trocar o DSN sem precisar de um novo deploy de código.
import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN =
  process.env.NEXT_PUBLIC_SENTRY_DSN ??
  "https://67b9c1bd479b4999f8a00b405b34bb0e@o4512087423385600.ingest.us.sentry.io/4512091809316864";

Sentry.init({
  dsn: SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
