import { requireOwnerPage } from "@/lib/tenant";
import { PagamentosForm } from "@/components/painel/pagamentos/PagamentosForm";
import { PixAutoCard } from "@/components/painel/pagamentos/PixAutoCard";
import { getPixAutoConfig } from "@/lib/pixAuto";
import { readPixSettingsStatus } from "@/lib/pixCharge";

// Separação onboarding/painel: esta era uma tela de redirecionamento para o
// Passo 6 do onboarding (ver histórico do arquivo); agora é a tela real de
// edição — nunca redireciona para /onboarding.
// Restrita ao OWNER (JON-10): fora do escopo operacional/cardápio.
export default async function PagamentosPage() {
  const { supabase, restaurant } = await requireOwnerPage();
  // Pix automático: o cartão só aparece quando o SERVIDOR está configurado (desligado por padrão).
  const pixAutoStatus = getPixAutoConfig() ? await readPixSettingsStatus(supabase, restaurant.id) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-headline-lg text-graphite">Pagamentos</h1>
        <p className="mt-0.5 text-body-md text-text-muted">Formas de pagamento aceitas pela sua loja.</p>
      </div>

      <PagamentosForm restaurant={restaurant} />

      {pixAutoStatus && <PixAutoCard status={pixAutoStatus} />}
    </div>
  );
}
