import { redirect } from "next/navigation";
import { getAuthedUser, getMyRestaurant } from "@/lib/tenant";
import { getActiveOrdersForKanban } from "@/lib/orders";
import { KanbanBoard } from "@/components/painel/pedidos/KanbanBoard";

export default async function Page() {
  // Guarda redundante à do layout (barato e explícito) — restaurantId é
  // usado direto pela query e pelo filtro do canal realtime.
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const initialOrders = await getActiveOrdersForKanban(supabase, restaurant.id);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="px-4 pt-4">
        <h1 className="text-xl font-extrabold text-graphite">Pedidos</h1>
        <p className="text-sm text-text-muted">Acompanhe e avance os pedidos em tempo real.</p>
      </div>
      <KanbanBoard restaurantId={restaurant.id} initialOrders={initialOrders} />
    </div>
  );
}
