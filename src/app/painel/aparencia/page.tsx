import { requireOwnerPage } from "@/lib/tenant";
import { getPublicAssetUrl } from "@/lib/storage/assets";
import { AparenciaClient } from "@/components/painel/aparencia/AparenciaClient";

// Restrita ao OWNER (JON-10): fora do escopo operacional/cardápio.
export default async function AparenciaPage() {
  const { supabase, restaurant } = await requireOwnerPage();

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-graphite">Aparência</h1>
        <p className="mt-0.5 text-sm font-medium text-text-muted">
          Logo e capa são exibidos no topo da sua loja pública, para os clientes reconhecerem sua marca.
        </p>
      </div>

      <AparenciaClient
        logoUrl={restaurant.logo_path ? getPublicAssetUrl(supabase, restaurant.logo_path) : null}
        coverUrl={restaurant.cover_path ? getPublicAssetUrl(supabase, restaurant.cover_path) : null}
      />
    </div>
  );
}
