import { redirect } from "next/navigation";
import { getAuthedUser, getMyRestaurant } from "@/lib/tenant";
import { getRecentOrders } from "@/lib/orders";
import { getStoreUrl } from "@/lib/site-url";
import { Card } from "@/components/ui/Card";
import { StoreStatusCard } from "@/components/painel/configuracoes/StoreStatusCard";
import { StoreShareCard } from "@/components/painel/dashboard/StoreShareCard";

/**
 * Configurações gerais (JON-24) — nesta rodada, só o que já era esforço de
 * schema zero no discovery (JON-11): pausar/reabrir a loja
 * (restaurants.status, já existente) e o link/QR Code da loja pública
 * (StoreShareCard, já construído para o Dashboard na Sprint 4 — reaproveitado
 * aqui, não duplicado). Bio da loja, e-mail de contato e os toggles de
 * regra de pedido (aceitar só em horário, checkout convidado, WhatsApp
 * flutuante) ficaram de fora de propósito: exigiriam colunas novas em
 * `restaurants`, fora do escopo autorizado para esta tarefa.
 */
export default async function ConfiguracoesPage() {
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const [recentOrders, storeUrl] = await Promise.all([
    getRecentOrders(supabase, restaurant.id, 1),
    getStoreUrl(restaurant.slug),
  ]);

  // draft/closed não são estados que este toggle sabe reverter (draft ainda
  // nem terminou o onboarding; closed não é exposto ao lojista) — mostra um
  // aviso neutro em vez de uma ação que a Server Action rejeitaria.
  const canToggleStatus = restaurant.status === "active" || restaurant.status === "paused";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-graphite">Configurações gerais</h1>
        <p className="mt-0.5 text-sm font-medium text-text-muted">Status da loja e link público de divulgação.</p>
      </div>

      {canToggleStatus ? (
        <StoreStatusCard initialStatus={restaurant.status === "paused" ? "paused" : "active"} />
      ) : (
        <Card className="p-6">
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-text-muted">Status da loja</h2>
          <p className="mt-1 text-sm text-text-muted">
            Finalize o cadastro da sua loja para poder pausar ou reabrir o recebimento de pedidos por aqui.
          </p>
        </Card>
      )}

      <StoreShareCard
        storeUrl={storeUrl}
        storeName={restaurant.name}
        isActive={restaurant.status === "active"}
        hasAnyOrder={recentOrders.length > 0}
      />
    </div>
  );
}
