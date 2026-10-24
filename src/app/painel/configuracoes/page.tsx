import Link from "next/link";
import { getActivePlans, getAuthedUser, requireOwnerPage } from "@/lib/tenant";
import { getRecentOrders } from "@/lib/orders";
import { getStoreUrl } from "@/lib/site-url";
import { Card } from "@/components/ui/Card";
import { StoreStatusCard } from "@/components/painel/configuracoes/StoreStatusCard";
import { ContactInfoForm } from "@/components/painel/configuracoes/ContactInfoForm";
import { StoreShareCard } from "@/components/painel/dashboard/StoreShareCard";
import { InformacoesForm } from "@/components/painel/informacoes/InformacoesForm";

/**
 * Configurações gerais (redesign Stitch, área "Configurações Gerais") —
 * reúne tudo da loja numa tela só: status, nome e endereço (InformacoesForm,
 * que antes tinha tela própria; /painel/informacoes agora redireciona para
 * cá), contato, divulgação e conta. Pausar/reabrir a loja
 * (restaurants.status) e o link/QR Code (StoreShareCard, já construído
 * para o Dashboard) são reaproveitados sem duplicar. Contato
 * (WhatsApp/e-mail) e bio são o gap real desta tela (ContactInfoForm).
 *
 * Fora de escopo, decidido com o usuário: toggle para desligar a checagem
 * de horário de funcionamento no checkout (create_order já a aplica
 * sempre — expor um jeito de desligá-la seria um risco de produto sem
 * pedido claro para isso) e "Dados da Conta MenuNext"/billing (bloqueado,
 * mesma decisão de Caixa/Plano).
 */
const SECTIONS = [
  { id: "status", label: "Status" },
  { id: "nome-e-endereco", label: "Nome e endereço" },
  { id: "contato", label: "Contato" },
  { id: "divulgacao", label: "Divulgação" },
  { id: "conta", label: "Conta" },
] as const;

export default async function ConfiguracoesPage() {
  const { supabase, restaurant } = await requireOwnerPage();

  const [recentOrders, storeUrl, plans, { user }] = await Promise.all([
    getRecentOrders(supabase, restaurant.id, 1),
    getStoreUrl(restaurant.slug),
    getActivePlans(supabase),
    getAuthedUser(),
  ]);
  const planName = restaurant.plan_id ? (plans.find((p) => p.id === restaurant.plan_id)?.name ?? null) : null;
  const rawOwnerName = user?.user_metadata?.name;
  const ownerName = typeof rawOwnerName === "string" && rawOwnerName.trim() ? rawOwnerName.trim() : null;

  // draft/closed não são estados que este toggle sabe reverter (draft ainda
  // nem terminou o onboarding; closed não é exposto ao lojista) — mostra um
  // aviso neutro em vez de uma ação que a Server Action rejeitaria.
  const canToggleStatus = restaurant.status === "active" || restaurant.status === "paused";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <div>
        <h1 className="text-headline-lg text-graphite">Configurações da loja</h1>
        <p className="mt-0.5 text-body-md text-text-muted">
          Status, nome e endereço, contato, link de divulgação e dados da conta, tudo em um lugar.
        </p>
      </div>

      <nav aria-label="Seções" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="shrink-0 rounded-full border border-border bg-surface-card px-3.5 py-1.5 text-label-md font-bold text-graphite transition-colors hover:bg-surface-subdued"
          >
            {section.label}
          </a>
        ))}
      </nav>

      <section id="status" className="scroll-mt-4">
        {canToggleStatus ? (
          <StoreStatusCard initialStatus={restaurant.status === "paused" ? "paused" : "active"} />
        ) : (
          <Card className="p-6">
            <h2 className="text-body-lg font-bold uppercase tracking-wide text-text-muted">Status da loja</h2>
            <p className="mt-1 text-body-md text-text-muted">
              Finalize o cadastro da sua loja para poder pausar ou reabrir o recebimento de pedidos por aqui.
            </p>
          </Card>
        )}
      </section>

      <section id="nome-e-endereco" className="scroll-mt-4">
        <InformacoesForm restaurant={restaurant} />
      </section>

      <section id="contato" className="scroll-mt-4">
        <ContactInfoForm restaurant={restaurant} />
      </section>

      <section id="divulgacao" className="scroll-mt-4">
        <StoreShareCard
          storeUrl={storeUrl}
          storeName={restaurant.name}
          isActive={restaurant.status === "active"}
          hasAnyOrder={recentOrders.length > 0}
        />
      </section>

      <section id="conta" className="scroll-mt-4">
        <Card className="p-6">
          <h2 className="text-body-lg font-bold text-graphite">Dados da conta MenuNext</h2>
          <dl className="mt-3 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-label-sm uppercase text-text-muted">Proprietário</dt>
              <dd className="mt-0.5 text-body-md text-graphite">{ownerName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-label-sm uppercase text-text-muted">E-mail de acesso</dt>
              <dd className="mt-0.5 break-all text-body-md text-graphite">{user?.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-label-sm uppercase text-text-muted">Plano</dt>
              <dd className="mt-0.5 text-body-md text-graphite">{planName ?? "Sem plano contratado"}</dd>
            </div>
          </dl>
          <Link href="/painel/plano" className="mt-4 inline-block text-label-lg text-primary hover:underline">
            Ver plano e assinatura →
          </Link>
          <p className="mt-3 text-body-sm text-text-muted">
            Para convidar atendentes, use{" "}
            <Link href="/painel/usuarios" className="font-semibold text-primary underline">
              Usuários
            </Link>
            .
          </p>
        </Card>
      </section>
    </div>
  );
}
