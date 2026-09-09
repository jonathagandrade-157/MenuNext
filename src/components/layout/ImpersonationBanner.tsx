import Link from "next/link";

/**
 * Banner exigido quando o MASTER está gerenciando a loja de um lojista.
 * Visual apenas nesta Sprint — a autenticação/autorização e a auditoria
 * reais do modo impersonation serão implementadas em Sprint futura.
 */
export function ImpersonationBanner({ storeName }: { storeName: string }) {
  return (
    <div className="flex items-center justify-between gap-4 bg-amber px-6 py-2 text-sm font-semibold text-graphite">
      <span>Você está gerenciando esta loja: {storeName}</span>
      <Link href="/master" className="underline underline-offset-2 hover:no-underline">
        Voltar ao painel Master
      </Link>
    </div>
  );
}
