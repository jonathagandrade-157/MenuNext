import { redirect } from "next/navigation";
import { getAuthedUser, getMyRestaurant } from "@/lib/tenant";
import { getActiveOrdersForKanban, getDashboardOrderMetrics, KDS_COLUMNS } from "@/lib/orders";
import { KanbanBoard } from "@/components/painel/pedidos/KanbanBoard";

/**
 * KDS — Cozinha (JON-23). Visão focada em preparo, derivada do mesmo
 * KanbanBoard de /painel/pedidos (mesma fonte de dados, mesma RPC de
 * avanço de status, mesmo Realtime) — só restringe as colunas visíveis
 * (KDS_COLUMNS) e liga o cronômetro de tempo decorrido por pedido, usando
 * a meta de tempo de preparo (metrics.averagePrepMinutes) já calculada
 * para o Dashboard. Nenhuma tabela/coluna nova.
 */
export default async function KdsPage() {
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const [initialOrders, metrics] = await Promise.all([
    getActiveOrdersForKanban(supabase, restaurant.id),
    getDashboardOrderMetrics(supabase, restaurant.id),
  ]);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="px-4 pt-4">
        <h1 className="text-xl font-extrabold text-graphite">Cozinha (KDS)</h1>
        <p className="text-sm text-text-muted">
          Fila de preparo em tempo real — novos pedidos, em preparo e prontos para despacho.
          {metrics.averagePrepMinutes !== null && (
            <> Meta de preparo hoje: {Math.round(metrics.averagePrepMinutes)} min.</>
          )}
        </p>
      </div>
      <KanbanBoard
        restaurantId={restaurant.id}
        initialOrders={initialOrders}
        columns={KDS_COLUMNS}
        channelPrefix="kds"
        showElapsedTime
        targetPrepMinutes={metrics.averagePrepMinutes}
      />
    </div>
  );
}
