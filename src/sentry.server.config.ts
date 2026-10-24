// Sentry — runtime servidor (Node), importado condicionalmente por
// instrumentation.ts. DSN vem de SENTRY_DSN (configurada na Vercel) —
// mesmo projeto Sentry dos outros dois runtimes.
import * as Sentry from "@sentry/nextjs";
import { scrubSensitiveRequestData } from "@/lib/sentryScrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  // Credenciais (token do webhook do Asaas, Authorization, cookies) nunca saem do servidor.
  beforeSend: (event) => scrubSensitiveRequestData(event),
});
