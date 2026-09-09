import Link from "next/link";
import { requireOnboardingCompleted } from "@/lib/tenant";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CopyLinkButton } from "@/components/onboarding/CopyLinkButton";

export default async function LojaProntaPage() {
  const { restaurant } = await requireOnboardingCompleted();
  const storeUrl = `menunext.com.br/${restaurant.slug}`;

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-surface-card">
        <div className="mx-auto flex h-16 max-w-2xl items-center px-6">
          <Link href="/" className="text-base font-extrabold text-graphite">
            Menu<span className="text-primary">Next</span>
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-6 py-12 text-center">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald">
          Onboarding concluído com sucesso
        </p>
        <h1 className="mt-2 text-3xl font-extrabold text-graphite">Sua loja está pronta! 🎉</h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-text-muted">
          Você configurou o essencial em minutos. Agora o {restaurant.name} tem uma vitrine digital pronta para
          receber pedidos.
        </p>

        <Card className="mt-8 p-6 text-left">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-graphite">{restaurant.name}</p>
              <p className="text-xs text-text-muted">7 de 7 etapas configuradas</p>
            </div>
            <Badge tone="success" pulse>
              Loja Aberta
            </Badge>
          </div>

          <div className="mt-5 rounded-lg bg-surface-subdued px-4 py-3">
            <p className="text-xs font-semibold text-text-muted">Seu endereço digital</p>
            <p className="mt-1 font-mono text-sm text-graphite">{storeUrl}</p>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <CopyLinkButton url={`https://${storeUrl}`} />
            <LinkButton href={`/loja/${restaurant.slug}`} variant="secondary">
              Ver como cliente ↗
            </LinkButton>
          </div>
        </Card>

        <LinkButton href="/painel" size="lg" className="mt-8">
          Ir para o painel
        </LinkButton>
      </div>
    </div>
  );
}
