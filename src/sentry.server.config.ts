// Sentry — runtime servidor (Node), importado condicionalmente por
// instrumentation.ts. Mesmo DSN de instrumentation-client.ts — ver
// comentário lá sobre por que não é um secret.
import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN =
  process.env.SENTRY_DSN ??
  "https://67b9c1bd479b4999f8a00b405b34bb0e@o4512087423385600.ingest.us.sentry.io/4512091809316864";

Sentry.init({
  dsn: SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  // JON-21 (temporário): eventos de erro não estavam chegando no Sentry em
  // produção apesar do throw e do DSN corretos — debug expõe no log da
  // função se o SDK está de fato tentando enviar o evento. Remover depois
  // de confirmar a causa.
  debug: true,
});
