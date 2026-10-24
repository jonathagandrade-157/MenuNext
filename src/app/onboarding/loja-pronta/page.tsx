import Link from "next/link";
import { ArrowRight, Check, CircleDashed } from "lucide-react";
import { getOnboardingProgress, requireOnboardingCompleted } from "@/lib/tenant";
import { getStoreUrl } from "@/lib/site-url";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CopyLinkButton } from "@/components/onboarding/CopyLinkButton";

// Etapa do onboarding -> onde ela é refeita no painel (nunca volta para o onboarding).
const STEPS: { step: number; label: string; href: string }[] = [
  { step: 1, label: "Nome e endereço da loja", href: "/painel/configuracoes#nome-e-endereco" },
  { step: 2, label: "Endereço do restaurante", href: "/painel/configuracoes#nome-e-endereco" },
  { step: 3, label: "Como você atende", href: "/painel/delivery" },
  { step: 4, label: "Taxa e raio de entrega", href: "/painel/delivery" },
  { step: 5, label: "Horários de funcionamento", href: "/painel/horarios" },
  { step: 6, label: "Formas de pagamento", href: "/painel/pagamentos" },
  { step: 7, label: "Primeiro produto", href: "/painel/produtos" },
];

const NEXT_STEPS = [
  { title: "Cadastrar mais produtos", description: "Fotos e adicionais vendem mais.", href: "/painel/produtos" },
  { title: "Deixar a loja com a sua cara", description: "Logo, cores e banner promocional.", href: "/painel/aparencia" },
  { title: "Divulgar", description: "Link, QR Code e cartaz para imprimir.", href: "/painel/configuracoes#divulgacao" },
];

const STATUS_BADGE = {
  active: { tone: "success", label: "Loja aberta", pulse: true },
  paused: { tone: "warning", label: "Loja pausada", pulse: false },
} as const;

export default async function LojaProntaPage() {
  const { supabase, restaurant } = await requireOnboardingCompleted();
  const [progress, storeUrl] = await Promise.all([getOnboardingProgress(supabase, restaurant.id), getStoreUrl(restaurant.slug)]);

  // completed_steps só tem os passos realmente salvos ("Pular por enquanto" não conta).
  const done = new Set(progress?.completed_steps ?? []);
  const pending = STEPS.filter((s) => !done.has(s.step));
  const badge = restaurant.status === "active" || restaurant.status === "paused" ? STATUS_BADGE[restaurant.status] : null;

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-surface-card">
        <div className="mx-auto flex h-16 max-w-2xl items-center px-4 sm:px-6">
          <Link href="/" className="text-body-lg font-extrabold text-graphite">
            Menu<span className="text-primary">Next</span>
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-8 text-center sm:px-6 sm:py-12">
        <p className="text-body-sm font-bold uppercase tracking-widest text-emerald">Cadastro concluído</p>
        <h1 className="mt-2 text-3xl font-extrabold text-graphite">Sua loja está pronta! 🎉</h1>
        <p className="mx-auto mt-3 max-w-md text-body-md text-text-muted">
          Agora o {restaurant.name} tem uma vitrine digital pronta para receber pedidos.
        </p>

        <Card className="mt-8 p-5 text-left sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-label-lg text-graphite">{restaurant.name}</p>
              <p className="text-body-sm text-text-muted">
                {done.size} de {STEPS.length} etapas configuradas
              </p>
            </div>
            {badge && (
              <Badge tone={badge.tone} pulse={badge.pulse}>
                {badge.label}
              </Badge>
            )}
          </div>

          <div className="mt-5 rounded-lg bg-surface-subdued px-4 py-3">
            <p className="text-body-sm font-semibold text-text-muted">Seu endereço digital</p>
            <p className="mt-1 break-all font-mono text-body-md text-graphite">{storeUrl}</p>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <CopyLinkButton url={storeUrl} />
            <LinkButton href={`/loja/${restaurant.slug}`} variant="secondary">
              Ver como cliente ↗
            </LinkButton>
          </div>
        </Card>

        {pending.length > 0 && (
          <Card className="mt-4 p-5 text-left sm:p-6">
            <h2 className="text-label-lg text-graphite">Ainda falta configurar</h2>
            <p className="mt-0.5 text-body-sm text-text-muted">Você pulou estas etapas. Termine quando quiser, direto no painel.</p>
            <ul className="mt-3 divide-y divide-border">
              {pending.map((item) => (
                <li key={item.step}>
                  <Link href={item.href} className="flex items-center gap-3 py-2.5 text-body-md text-graphite hover:text-primary">
                    <CircleDashed className="h-4.5 w-4.5 shrink-0 text-amber-strong" aria-hidden />
                    <span className="flex-1">{item.label}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className="mt-4 grid gap-3 text-left sm:grid-cols-3">
          {NEXT_STEPS.map((item) => (
            <Link key={item.href} href={item.href} className="group">
              <Card className="h-full p-4 transition-colors group-hover:border-primary/40">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald/10 text-emerald">
                  <Check className="h-4 w-4" aria-hidden />
                </span>
                <p className="mt-2 text-body-md font-bold text-graphite">{item.title}</p>
                <p className="mt-0.5 text-body-sm text-text-muted">{item.description}</p>
              </Card>
            </Link>
          ))}
        </div>

        <LinkButton href="/painel" size="lg" className="mt-8">
          Ir para o painel
        </LinkButton>
      </div>
    </div>
  );
}
