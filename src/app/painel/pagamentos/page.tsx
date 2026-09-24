import { requireOwnerPage } from "@/lib/tenant";
import { PagamentosForm } from "@/components/painel/pagamentos/PagamentosForm";

// Separação onboarding/painel: esta era uma tela de redirecionamento para o
// Passo 6 do onboarding (ver histórico do arquivo); agora é a tela real de
// edição — nunca redireciona para /onboarding.
// Restrita ao OWNER (JON-10): fora do escopo operacional/cardápio.
export default async function PagamentosPage() {
  const { restaurant } = await requireOwnerPage();

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-graphite">Pagamentos</h1>
        <p className="mt-0.5 text-sm font-medium text-text-muted">Formas de pagamento aceitas pela sua loja.</p>
      </div>

      <PagamentosForm restaurant={restaurant} />
    </div>
  );
}
