import { redirect } from "next/navigation";
import { getAuthedUser, getMyRestaurant } from "@/lib/tenant";
import { getActiveOrdersForKanban, getOrderHistory } from "@/lib/orders";
import { PedidosTabs } from "@/components/painel/pedidos/PedidosTabs";

export default async function Page() {
  // Guarda redundante à do layout (barato e explícito) — restaurantId é
  // usado direto pela query e pelo filtro do canal realtime.
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const [initialActiveOrders, initialHistoryOrders] = await Promise.all([
    getActiveOrdersForKanban(supabase, restaurant.id),
    getOrderHistory(supabase, restaurant.id),
  ]);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="px-4 pt-4">
        <h1 className="text-xl font-extrabold text-graphite">Pedidos</h1>
        <p className="text-sm text-text-muted">Acompanhe pedidos em tempo real ou consulte o histórico completo.</p>
      </div>
      <PedidosTabs
        restaurantId={restaurant.id}
        initialActiveOrders={initialActiveOrders}
        initialHistoryOrders={initialHistoryOrders}
      />
    </div>
  );
}
