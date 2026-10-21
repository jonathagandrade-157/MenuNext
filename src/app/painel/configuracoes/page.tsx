import Link from "next/link";
import { getActivePlans, getAuthedUser, requireOwnerPage } from "@/lib/tenant";
import { getRecentOrders } from "@/lib/orders";
import { getStoreUrl } from "@/lib/site-url";
import { Card } from "@/components/ui/Card";
import { StoreStatusCard } from "@/components/painel/configuracoes/StoreStatusCard";
import { ContactInfoForm } from "@/components/painel/configuracoes/ContactInfoForm";
import { StoreShareCard } from "@/components/painel/dashboard/StoreShareCard";

/**
 * Configurações gerais (redesign Stitch, área "Configurações Gerais") —
 * nome do restaurante e endereço já são editáveis em /painel/informacoes
 * (linkado abaixo, não duplicado aqui). Pausar/reabrir a loja
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
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-headline-lg text-graphite">Configurações gerais</h1>
        <p className="mt-0.5 text-body-md text-text-muted">Status da loja, contato, bio e link público de divulgação.</p>
      </div>

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

      <Card className="p-6">
        <h2 className="text-body-lg font-bold uppercase tracking-wide text-text-muted">Nome e endereço</h2>
        <p className="mt-1 text-body-md text-text-muted">
          Nome do restaurante, URL da loja e endereço completo ficam em Informações do restaurante.
        </p>
        <Link href="/painel/informacoes" className="mt-2 inline-block text-label-lg text-primary hover:underline">
          Editar informações do restaurante →
        </Link>
      </Card>

      <ContactInfoForm restaurant={restaurant} />

      <StoreShareCard
        storeUrl={storeUrl}
        storeName={restaurant.name}
        isActive={restaurant.status === "active"}
        hasAnyOrder={recentOrders.length > 0}
      />
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
    </div>
  );
}
