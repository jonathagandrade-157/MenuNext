import { getBusinessHours, requireOwnerPage } from "@/lib/tenant";
import { HorariosForm } from "@/components/painel/horarios/HorariosForm";

// Separação onboarding/painel: esta era uma tela de redirecionamento para o
// Passo 5 do onboarding (ver histórico do arquivo); agora é a tela real de
// edição — nunca redireciona para /onboarding.
// Restrita ao OWNER (JON-10): fora do escopo operacional/cardápio.
export default async function HorariosPage() {
  const { supabase, restaurant } = await requireOwnerPage();

  const businessHours = await getBusinessHours(supabase, restaurant.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-graphite">Horários</h1>
        <p className="mt-0.5 text-sm font-medium text-text-muted">Dias e horários em que sua loja aceita pedidos.</p>
      </div>

      <HorariosForm businessHours={businessHours} />
    </div>
  );
}
