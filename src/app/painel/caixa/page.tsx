import { redirect } from "next/navigation";
import { getAuthedUser, getMyMembership, getMyRestaurant } from "@/lib/tenant";
import { getPublicCategoriesWithProducts } from "@/lib/store";
import { getPublicAssetUrl } from "@/lib/storage/assets";
import { getCashHistory, getCurrentCashSession } from "@/lib/cash";
import { CaixaClient } from "@/components/painel/caixa/CaixaClient";
import { CashSessionBar } from "@/components/painel/caixa/CashSessionBar";
import { CashHistory } from "@/components/painel/caixa/CashHistory";

// Frente de Caixa / PDV real (decisão tomada com o usuário): pedidos de
// balcão usam fulfillment_type='counter' (novo), reaproveitando
// create_order/advance_order_status/cancel_order e todo o fluxo de
// KDS/Kanban já existentes — ver migration add_counter_orders.sql.
// Acessível a STAFF (operacional, mesmo grupo de Pedidos/KDS/Cardápio no
// layout do painel — não é ownerOnly). Abrir/fechar o caixa também é do STAFF;
// o histórico de diferenças de caixa é só do OWNER (cash_history devolve vazio aos demais).
export default async function CaixaPage() {
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const getImageUrl = (path: string) => getPublicAssetUrl(supabase, path);
  const [categories, cashSession, membership] = await Promise.all([
    getPublicCategoriesWithProducts(supabase, restaurant.id, getImageUrl),
    getCurrentCashSession(supabase),
    getMyMembership(supabase, restaurant.id),
  ]);
  const history = membership?.role === "OWNER" ? await getCashHistory(supabase, 15) : [];

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <div>
        <h1 className="text-headline-lg text-graphite">Frente de Caixa</h1>
        <p className="mt-0.5 text-body-md text-text-muted">
          Registre vendas de balcão e telefone. O pedido entra direto no Kanban/KDS, igual aos pedidos online.
        </p>
      </div>

      <CashSessionBar session={cashSession} />

      <CaixaClient
        categories={categories}
        paymentPix={restaurant.payment_pix}
        paymentCash={restaurant.payment_cash}
        paymentCard={restaurant.payment_card}
        cashOpen={cashSession !== null}
      />

      <CashHistory rows={history} />
    </div>
  );
}
