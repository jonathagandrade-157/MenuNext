"use client";

export default function LojaError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="rounded-full bg-red/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red">
        Erro ao carregar
      </span>
      <h1 className="text-xl font-extrabold text-graphite">Não foi possível carregar esta loja</h1>
      <p className="max-w-xs text-sm text-text-muted">Ocorreu um problema ao buscar os dados. Tente novamente.</p>
      <button
        type="button"
        onClick={reset}
        className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-white"
      >
        Tentar novamente
      </button>
    </div>
  );
}
