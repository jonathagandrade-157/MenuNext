// Sentry — runtime cliente (browser). Arquivo lido pelo próprio Next.js
// (convenção instrumentation-client.ts), não pelo instrumentation.ts.
//
// Projeto Sentry do MenuNext (JON-21) — separado do projeto do Vexo, que
// tem seu próprio DSN e nunca é usado aqui. DSN vem só de
// NEXT_PUBLIC_SENTRY_DSN (configurada na Vercel), pra permitir trocar o
// DSN sem precisar de um novo deploy de código.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
