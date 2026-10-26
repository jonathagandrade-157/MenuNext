import type { Metadata } from "next";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export const metadata: Metadata = { title: "Página não encontrada — MenuNext" };

/** 404 de qualquer endereço que não existe (substitui a página padrão do Next, em inglês e sem identidade). */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <Card className="w-full max-w-md p-8 text-center">
        <span className="inline-flex rounded-full bg-surface-subdued px-3 py-1 text-label-md uppercase tracking-wide text-text-muted">
          Erro 404
        </span>
        <h1 className="mt-3 text-headline-md text-graphite">Página não encontrada</h1>
        <p className="mx-auto mt-2 max-w-xs text-body-md text-text-muted">
          O endereço pode estar incorreto ou a página não existe mais.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <LinkButton href="/">Voltar para o início</LinkButton>
        </div>
      </Card>
    </main>
  );
}
