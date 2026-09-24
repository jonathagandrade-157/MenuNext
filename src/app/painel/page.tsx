import { redirect } from "next/navigation";
import { getAuthedUser, getMyRestaurant, getProducts } from "@/lib/tenant";
import { formatCurrencyBRL, getDashboardOrderMetrics, getRecentOrders } from "@/lib/orders";
import { getBestSellingProducts } from "@/lib/bestsellers";
import { getCustomerOrders } from "@/lib/customers";
import { getSetupChecklist } from "@/lib/setup";
import { getStoreUrl } from "@/lib/site-url";
import {
  computeBestSellersToday,
  computeChannelSplit,
  computeCustomersToday,
  computeDashboardInsights,
  computeDeliveryToday,
  computeEstimatedMargin,
  computeHourlyMovement,
  computeLiveQueue,
  computePaymentSplit,
  computeYesterdayComparison,
  getActiveOrderStatuses,
  getTodayOrdersDetailed,
  getYesterdaySameWindowRevenue,
} from "@/lib/dashboard";
import { Card } from "@/components/ui/Card";
import { SetupChecklistCard } from "@/components/painel/SetupChecklistCard";
import { StoreShareCard } from "@/components/painel/dashboard/StoreShareCard";
import { StoreStatusBar } from "@/components/painel/dashboard/StoreStatusBar";
import { MovementChart } from "@/components/painel/dashboard/MovementChart";
import { LiveQueueCard } from "@/components/painel/dashboard/LiveQueueCard";
import { MarginCard } from "@/components/painel/dashboard/MarginCard";
import { ChannelSplitCard } from "@/components/painel/dashboard/ChannelSplitCard";
import { PaymentSplitCard } from "@/components/painel/dashboard/PaymentSplitCard";
import { DeliveryTodayCard } from "@/components/painel/dashboard/DeliveryTodayCard";
import { CustomersTodayCard } from "@/components/painel/dashboard/CustomersTodayCard";
import { InsightsRow } from "@/components/painel/dashboard/InsightsRow";
import { QuickActionsCard } from "@/components/painel/dashboard/QuickActionsCard";
import { RecentOrdersCard } from "@/components/painel/dashboard/RecentOrdersCard";
import { BestSellersCard } from "@/components/painel/dashboard/BestSellersCard";

export default async function PainelDashboardPage() {
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const [
    metrics,
    checklist,
    recentOrders,
    bestSellers,
    storeUrl,
    todayOrders,
    yesterday,
    activeStatuses,
    products,
    allCustomerOrders,
  ] = await Promise.all([
    getDashboardOrderMetrics(supabase, restaurant.id),
    getSetupChecklist(supabase, restaurant),
    getRecentOrders(supabase, restaurant.id),
    getBestSellingProducts(supabase, restaurant.id),
    getStoreUrl(restaurant.slug),
    getTodayOrdersDetailed(supabase, restaurant.id),
    getYesterdaySameWindowRevenue(supabase, restaurant.id),
    getActiveOrderStatuses(supabase, restaurant.id),
    getProducts(supabase, restaurant.id),
    getCustomerOrders(supabase, restaurant.id),
  ]);

  // Não é uma query extra: getRecentOrders já busca (sem filtro de status)
  // os pedidos mais recentes, então "não vazio" já prova "existe pelo menos
  // 1 pedido" — ver comentário de getRecentOrders em src/lib/orders.ts.
  const hasAnyOrder = recentOrders.length > 0;

  const productCostById = new Map(products.filter((p) => p.cost !== null).map((p) => [p.id, p.cost as number]));
  const unavailableProductCount = products.filter((p) => !p.is_available).length;

  const hourlyMovement = computeHourlyMovement(todayOrders);
  const liveQueue = computeLiveQueue(activeStatuses);
  const margin = computeEstimatedMargin(
    todayOrders.flatMap((o) => o.order_items),
    productCostById
  );
  const bestSellersToday = computeBestSellersToday(todayOrders);
  const channelSplit = computeChannelSplit(todayOrders);
  const paymentSplit = computePaymentSplit(todayOrders);
  const deliveryToday = computeDeliveryToday(todayOrders);
  const customersToday = computeCustomersToday(todayOrders, allCustomerOrders);
  const insights = computeDashboardInsights(bestSellersToday, hourlyMovement, channelSplit);
  const revenueComparison = computeYesterdayComparison(metrics.revenueToday, yesterday.revenue);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-extrabold text-graphite">Olá, bem-vindo ao {restaurant.name}</h1>
        <p className="mt-1 text-sm text-text-muted">Aqui está o resumo real da operação de hoje.</p>
      </div>

      <StoreStatusBar initialStatus={restaurant.status === "active" ? "active" : "paused"} unavailableProductCount={unavailableProductCount} />

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
          {revenueComparison !== null && (
            <p className={`mt-1 text-xs font-bold ${revenueComparison >= 0 ? "text-emerald" : "text-red"}`}>
              {revenueComparison >= 0 ? "↑" : "↓"} {Math.abs(revenueComparison).toFixed(1)}% vs. ontem
            </p>
          )}
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
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Clientes hoje</p>
          <p className="mt-1 text-2xl font-extrabold text-graphite">{customersToday.attended}</p>
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

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <MovementChart points={hourlyMovement} />
        </div>
        <LiveQueueCard queue={liveQueue} />
      </div>

      <MarginCard margin={margin} />

      <div className="grid gap-4 lg:grid-cols-2">
        <RecentOrdersCard orders={recentOrders} />
        <BestSellersCard products={bestSellers} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ChannelSplitCard split={channelSplit} />
        <PaymentSplitCard split={paymentSplit} />
        <DeliveryTodayCard delivery={deliveryToday} />
        <CustomersTodayCard customers={customersToday} />
      </div>

      <InsightsRow insights={insights} />

      <QuickActionsCard />
    </div>
  );
}
