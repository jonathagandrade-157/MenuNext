"use client";

import { Button, LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

/**
 * Error boundary do painel (App Router) — cobre /painel e todas as rotas
 * abaixo dela (não cobre erros lançados no próprio painel/layout.tsx, que
 * sobem para o boundary do segmento pai; limitação do App Router, não algo
 * a contornar aqui). Sem isso, uma falha inesperada (ex.: requisição
 * rejeitada por exceder o limite de corpo de uma Server Action) caía no
 * error boundary genérico do Next.js, sem a identidade visual do MenuNext
 * nem um caminho claro de recuperação.
 */
export default function PainelError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 py-16">
      <Card className="w-full max-w-md p-8 text-center">
        <span className="inline-flex rounded-full bg-red/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red">
          Erro inesperado
        </span>
        <h1 className="mt-3 text-xl font-extrabold text-graphite">Algo não funcionou como esperado</h1>
        <p className="mx-auto mt-2 max-w-xs text-sm text-text-muted">
          Ocorreu um problema ao processar sua solicitação. Tente novamente ou volte ao painel.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button type="button" onClick={reset}>
            Tentar novamente
          </Button>
          <LinkButton href="/painel" variant="secondary">
            Voltar ao painel
          </LinkButton>
        </div>
      </Card>
    </div>
  );
}
