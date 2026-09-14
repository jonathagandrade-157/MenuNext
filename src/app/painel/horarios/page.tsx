import { redirect } from "next/navigation";
import { getAuthedUser, getBusinessHours, getMyRestaurant } from "@/lib/tenant";
import { HorariosForm } from "@/components/painel/horarios/HorariosForm";

// Separação onboarding/painel: esta era uma tela de redirecionamento para o
// Passo 5 do onboarding (ver histórico do arquivo); agora é a tela real de
// edição — nunca redireciona para /onboarding.
export default async function HorariosPage() {
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

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
