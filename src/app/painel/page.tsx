import { redirect } from "next/navigation";
import { getAuthedUser, getMyRestaurant } from "@/lib/tenant";
import { formatCurrencyBRL, getDashboardOrderMetrics, getRecentOrders } from "@/lib/orders";
import { getBestSellingProducts } from "@/lib/bestsellers";
import { getSetupChecklist } from "@/lib/setup";
import { getStoreUrl } from "@/lib/site-url";
import { Card } from "@/components/ui/Card";
import { SetupChecklistCard } from "@/components/painel/SetupChecklistCard";
import { StoreShareCard } from "@/components/painel/dashboard/StoreShareCard";
import { RecentOrdersCard } from "@/components/painel/dashboard/RecentOrdersCard";
import { BestSellersCard } from "@/components/painel/dashboard/BestSellersCard";

export default async function PainelDashboardPage() {
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const [metrics, checklist, recentOrders, bestSellers, storeUrl] = await Promise.all([
    getDashboardOrderMetrics(supabase, restaurant.id),
    getSetupChecklist(supabase, restaurant),
    getRecentOrders(supabase, restaurant.id),
    getBestSellingProducts(supabase, restaurant.id),
    getStoreUrl(restaurant.slug),
  ]);

  // Não é uma query extra: getRecentOrders já busca (sem filtro de status)
  // os pedidos mais recentes, então "não vazio" já prova "existe pelo menos
  // 1 pedido" — ver comentário de getRecentOrders em src/lib/orders.ts.
  const hasAnyOrder = recentOrders.length > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-extrabold text-graphite">Olá, bem-vindo ao {restaurant.name}</h1>
        <p className="mt-1 text-sm text-text-muted">Aqui está o resumo real da operação de hoje.</p>
      </div>

      <StoreShareCard
        storeUrl={storeUrl}
        storeName={restaurant.name}
        isActive={restaurant.status === "active"}
        hasAnyOrder={hasAnyOrder}
      />

      <SetupChecklistCard checklist={checklist} storeSlug={restaurant.slug} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Faturamento hoje</p>
          <p className="mt-1 text-2xl font-extrabold text-graphite">{formatCurrencyBRL(metrics.revenueToday)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Pedidos hoje</p>
          <p className="mt-1 text-2xl font-extrabold text-graphite">{metrics.ordersToday}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Ticket médio</p>
          <p className="mt-1 text-2xl font-extrabold text-graphite">{formatCurrencyBRL(metrics.averageTicketToday)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Pedidos em andamento</p>
          <p className="mt-1 text-2xl font-extrabold text-graphite">{metrics.activeOrders}</p>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Entregues hoje</p>
          <p className="mt-1 text-2xl font-extrabold text-emerald">{metrics.deliveredToday}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Cancelados hoje</p>
          <p className="mt-1 text-2xl font-extrabold text-red">{metrics.cancelledToday}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Tempo médio de preparo</p>
          <p className="mt-1 text-2xl font-extrabold text-graphite">
            {metrics.averagePrepMinutes !== null ? `${Math.round(metrics.averagePrepMinutes)} min` : "—"}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Tempo médio até entrega</p>
          <p className="mt-1 text-2xl font-extrabold text-graphite">
            {metrics.averageDeliveryMinutes !== null ? `${Math.round(metrics.averageDeliveryMinutes)} min` : "—"}
          </p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RecentOrdersCard orders={recentOrders} />
        <BestSellersCard products={bestSellers} />
      </div>
    </div>
  );
}
