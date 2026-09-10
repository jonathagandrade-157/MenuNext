import Link from "next/link";

export function StoreProductNotFound({ slug }: { slug: string }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="rounded-full bg-surface-subdued px-3 py-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
        Produto não encontrado
      </span>
      <h1 className="text-xl font-extrabold text-graphite">Não encontramos esse produto</h1>
      <p className="max-w-xs text-sm text-text-muted">
        Ele pode ter sido removido do cardápio ou o link pode estar incorreto.
      </p>
      <Link href={`/loja/${slug}`} className="text-sm font-semibold text-primary hover:underline">
        ← Voltar para o cardápio
      </Link>
    </div>
  );
}
