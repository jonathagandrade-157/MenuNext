// Sentry — runtime edge (o Proxy/Middleware do MenuNext roda em edge),
// importado condicionalmente por instrumentation.ts. DSN vem de
// SENTRY_DSN (configurada na Vercel) — mesmo projeto Sentry dos outros
// dois runtimes.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
});
