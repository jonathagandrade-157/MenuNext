import Link from "next/link";

type ScreenPlaceholderProps = {
  screenId?: string;
  title: string;
  description: string;
  backHref?: string;
  backLabel?: string;
};

/**
 * Placeholder de rota da Sprint 0. Confirma que a estrutura de navegação
 * existe; a implementação visual completa (fiel à tela do Stitch indicada
 * em `screenId`) acontece nas próximas Sprints.
 */
export function ScreenPlaceholder({
  screenId,
  title,
  description,
  backHref,
  backLabel = "Voltar",
}: ScreenPlaceholderProps) {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      {screenId && (
        <span className="rounded-full bg-surface-subdued px-3 py-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
          {screenId}
        </span>
      )}
      <h1 className="text-2xl font-extrabold text-graphite">{title}</h1>
      <p className="max-w-md text-sm text-text-muted">{description}</p>
      <p className="text-xs font-semibold uppercase tracking-wide text-amber">
        Estrutura criada — implementação visual na próxima Sprint
      </p>
      {backHref && (
        <Link href={backHref} className="text-sm font-semibold text-primary hover:underline">
          ← {backLabel}
        </Link>
      )}
    </div>
  );
}
