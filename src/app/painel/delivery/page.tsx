import { getBusinessHours, getDeliveryZones, requireOwnerPage } from "@/lib/tenant";
import { isGeocodingConfigured } from "@/lib/geocoding";
import { DeliveryConfigForm } from "@/components/painel/delivery/DeliveryConfigForm";
import { DeliveryZonesManager } from "@/components/painel/delivery/DeliveryZonesManager";

// Consolidação do MVP de delivery (Fase 4.1): esta era uma tela de
// redirecionamento para o Passo 3 do onboarding (ver histórico do arquivo);
// agora é a tela real de configuração — reaproveita
// service_delivery/delivery_fee/delivery_radius_km (existentes desde o
// onboarding) e adiciona pedido mínimo + tempo estimado de entrega. Pode ser
// revisitada a qualquer momento, sem depender do fluxo guiado.
// Restrita ao OWNER (JON-10): fora do escopo operacional/cardápio.
export default async function Page() {
  const { supabase, restaurant } = await requireOwnerPage();

  const [businessHours, deliveryZones] = await Promise.all([
    getBusinessHours(supabase, restaurant.id),
    getDeliveryZones(supabase, restaurant.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-headline-lg text-graphite">Delivery</h1>
        <p className="mt-0.5 text-body-md text-text-muted">
          Configure como sua loja recebe e entrega pedidos por delivery.
        </p>
      </div>

      <DeliveryConfigForm restaurant={restaurant} businessHours={businessHours} geocodingConfigured={isGeocodingConfigured()} />

      <DeliveryZonesManager initialZones={deliveryZones} />
    </div>
  );
}
