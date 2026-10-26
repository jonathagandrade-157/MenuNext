"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import "./globals.css";

/**
 * Último recurso: erro no próprio layout raiz (o error.tsx não alcança, porque ele vive dentro do layout).
 * Substitui o documento inteiro, por isso traz <html> e <body> e importa os estilos por conta própria.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 text-center text-graphite">
        <main className="w-full max-w-md rounded-2xl border border-border bg-surface-card p-8">
          <h1 className="text-xl font-extrabold">Algo não funcionou como esperado</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm text-text-muted">
            O MenuNext encontrou um problema. Recarregue a página; se continuar, tente de novo em alguns minutos.
          </p>
          {/* Recarregar de verdade (não só tentar de novo): o erro pode estar no layout em si. */}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex h-11 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-white"
          >
            Recarregar
          </button>
        </main>
      </body>
    </html>
  );
}
