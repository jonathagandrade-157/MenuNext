"use client";

import { Button, LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

/**
 * Error boundary da raiz: páginas públicas fora do painel e da loja (landing, cadastro, termos, convite),
 * que antes caíam na tela genérica do Next. O painel (painel/error.tsx) e a loja (loja/[slug]/error.tsx)
 * têm os seus. O erro em si já vai ao Sentry pelo instrumentation.ts.
 */
export default function RootError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <Card className="w-full max-w-md p-8 text-center">
        <span className="inline-flex rounded-full bg-red/10 px-3 py-1 text-label-md uppercase tracking-wide text-red">
          Erro inesperado
        </span>
        <h1 className="mt-3 text-headline-md text-graphite">Algo não funcionou como esperado</h1>
        <p className="mx-auto mt-2 max-w-xs text-body-md text-text-muted">
          Ocorreu um problema ao carregar esta página. Tente novamente ou volte ao início.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button type="button" onClick={reset}>
            Tentar novamente
          </Button>
          <LinkButton href="/" variant="secondary">
            Voltar para o início
          </LinkButton>
        </div>
      </Card>
    </main>
  );
}
