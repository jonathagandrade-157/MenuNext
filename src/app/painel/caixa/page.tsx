import { redirect } from "next/navigation";
import { getAuthedUser, getMyRestaurant } from "@/lib/tenant";
import { getPublicCategoriesWithProducts } from "@/lib/store";
import { getPublicAssetUrl } from "@/lib/storage/assets";
import { CaixaClient } from "@/components/painel/caixa/CaixaClient";

// Frente de Caixa / PDV real (decisão tomada com o usuário): pedidos de
// balcão usam fulfillment_type='counter' (novo), reaproveitando
// create_order/advance_order_status/cancel_order e todo o fluxo de
// KDS/Kanban já existentes — ver migration add_counter_orders.sql.
// Acessível a STAFF (operacional, mesmo grupo de Pedidos/KDS/Cardápio no
// layout do painel — não é ownerOnly).
export default async function CaixaPage() {
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const getImageUrl = (path: string) => getPublicAssetUrl(supabase, path);
  const categories = await getPublicCategoriesWithProducts(supabase, restaurant.id, getImageUrl);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-graphite">Frente de Caixa</h1>
        <p className="mt-0.5 text-sm font-medium text-text-muted">
          Registre vendas de balcão e telefone. O pedido entra direto no Kanban/KDS, igual aos pedidos online.
        </p>
      </div>

      <CaixaClient
        categories={categories}
        paymentPix={restaurant.payment_pix}
        paymentCash={restaurant.payment_cash}
        paymentCard={restaurant.payment_card}
      />
    </div>
  );
}
