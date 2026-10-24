import { getCoupons, requireOwnerPage } from "@/lib/tenant";
import { getPromotions } from "@/lib/promotions";
import { CouponsManager } from "@/components/painel/marketing/CouponsManager";
import { PromotionsManager } from "@/components/painel/marketing/PromotionsManager";

// Restrita ao OWNER (JON-10): mesmo padrão de
// Delivery/Aparência/Horários/Pagamentos/Configurações/Usuários.
//
// Área "Marketing": promoções automáticas (desconto que entra sozinho no pedido) e cupons de desconto
// (código digitado pelo cliente). Os dois não acumulam — o pedido leva o maior desconto, decidido em
// create_order. Destaques da loja ficam na tela de Produtos (estrela) e o banner em Aparência.
export default async function MarketingPage() {
  const { supabase, restaurant } = await requireOwnerPage();

  const [coupons, promotions] = await Promise.all([getCoupons(supabase, restaurant.id), getPromotions(supabase, restaurant.id)]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <div>
        <h1 className="text-headline-lg text-graphite">Marketing</h1>
        <p className="mt-0.5 text-body-md text-text-muted">
          Promoções automáticas e cupons de desconto para atrair e fidelizar clientes. Quando as duas coisas valem no mesmo pedido,
          o cliente leva só o maior desconto.
        </p>
      </div>

      <PromotionsManager initialPromotions={promotions} />

      <CouponsManager initialCoupons={coupons} />
    </div>
  );
}
