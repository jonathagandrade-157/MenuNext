import { requireOwnerPage } from "@/lib/tenant";
import { InformacoesForm } from "@/components/painel/informacoes/InformacoesForm";

// Separação onboarding/painel: nome, URL e endereço do restaurante eram
// editáveis só pelos Passos 1 e 2 do onboarding. Esta é a tela própria do
// painel para isso — nunca redireciona para /onboarding.
// Restrita ao OWNER (JON-10): fora do escopo operacional/cardápio liberado
// para STAFF.
export default async function InformacoesPage() {
  const { restaurant } = await requireOwnerPage();

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-graphite">Informações</h1>
        <p className="mt-0.5 text-sm font-medium text-text-muted">
          Nome, endereço digital e localização do seu restaurante.
        </p>
      </div>

      <InformacoesForm restaurant={restaurant} />
    </div>
  );
}
