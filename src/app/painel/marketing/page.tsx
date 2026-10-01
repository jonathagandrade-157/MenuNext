import { getCoupons, requireOwnerPage } from "@/lib/tenant";
import { CouponsManager } from "@/components/painel/marketing/CouponsManager";

// Restrita ao OWNER (JON-10): mesmo padrão de
// Delivery/Aparência/Horários/Pagamentos/Configurações/Usuários.
//
// Área "Marketing" do redesign (referência Stitch) — do mockup completo
// (Promoções automáticas + Cupons + Destaques da Loja), esta entrega
// implementa só Cupons de Desconto, por decisão tomada com o usuário: o
// motor de promoções automáticas (5 mecânicas, janelas de horário,
// segmentação por item, disparo de WhatsApp) e os Destaques ficam de fora,
// sem schema/decisão de produto ainda — ver migration add_coupons.sql.
export default async function MarketingPage() {
  const { supabase, restaurant } = await requireOwnerPage();

  const coupons = await getCoupons(supabase, restaurant.id);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-graphite">Marketing</h1>
        <p className="mt-0.5 text-sm font-medium text-text-muted">
          Crie cupons de desconto para seus clientes usarem no checkout da sua loja.
        </p>
      </div>

      <CouponsManager initialCoupons={coupons} />
    </div>
  );
}
