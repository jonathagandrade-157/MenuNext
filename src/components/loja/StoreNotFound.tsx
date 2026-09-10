import Link from "next/link";

export function StoreNotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="rounded-full bg-surface-subdued px-3 py-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
        Loja não encontrada
      </span>
      <h1 className="text-xl font-extrabold text-graphite">Não encontramos essa loja</h1>
      <p className="max-w-xs text-sm text-text-muted">
        O endereço pode estar incorreto ou esta loja ainda não está disponível publicamente.
      </p>
      <Link href="/" className="text-sm font-semibold text-primary hover:underline">
        ← Voltar para a página inicial
      </Link>
    </div>
  );
}
