import { redirect } from "next/navigation";
import { getAuthedUser, getBusinessHours, getMyRestaurant } from "@/lib/tenant";
import { DeliveryConfigForm } from "@/components/painel/delivery/DeliveryConfigForm";

// Consolidação do MVP de delivery (Fase 4.1): esta era uma tela de
// redirecionamento para o Passo 3 do onboarding (ver histórico do arquivo);
// agora é a tela real de configuração — reaproveita
// service_delivery/delivery_fee/delivery_radius_km (existentes desde o
// onboarding) e adiciona pedido mínimo + tempo estimado de entrega. Pode ser
// revisitada a qualquer momento, sem depender do fluxo guiado.
export default async function Page() {
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const businessHours = await getBusinessHours(supabase, restaurant.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-graphite">Delivery</h1>
        <p className="mt-0.5 text-sm font-medium text-text-muted">
          Configure como sua loja recebe e entrega pedidos por delivery.
        </p>
      </div>

      <DeliveryConfigForm restaurant={restaurant} businessHours={businessHours} />
    </div>
  );
}
