import Link from "next/link";
import { Card } from "@/components/ui/Card";

/**
 * Atalhos operacionais (redesign Stitch) — só os que NÃO duplicam o que
 * StoreShareCard já oferece (ver minha loja / copiar link / compartilhar).
 * "Novo pedido manual" do mockup foi omitido: depende de Frente de
 * Caixa/PDV, uma feature bloqueada por decisão de produto (JON-29).
 */
export function QuickActionsCard() {
  const actions = [
    { href: "/painel/produtos/novo", label: "Novo produto" },
    { href: "/painel/delivery", label: "Configurar delivery" },
    { href: "/painel/clientes", label: "Ver base de clientes" },
  ];

  return (
    <Card className="p-5">
      <h2 className="text-sm font-extrabold text-graphite">Atalhos operacionais</h2>
      <p className="text-xs text-text-muted">Acesso rápido às funções mais utilizadas</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="inline-flex h-10 items-center rounded-xl border border-border bg-surface-card px-4 text-sm font-semibold text-graphite transition-all hover:border-slate-300 hover:bg-surface"
          >
            {action.label}
          </Link>
        ))}
      </div>
    </Card>
  );
}
