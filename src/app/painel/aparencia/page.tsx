import { requireOwnerPage } from "@/lib/tenant";
import { getPublicAssetUrl } from "@/lib/storage/assets";
import { AparenciaClient } from "@/components/painel/aparencia/AparenciaClient";

// Restrita ao OWNER (JON-10): fora do escopo operacional/cardápio.
export default async function AparenciaPage() {
  const { supabase, restaurant } = await requireOwnerPage();

  const { data: banner } = await supabase
    .from("restaurant_banners")
    .select("is_enabled, message")
    .eq("restaurant_id", restaurant.id)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-headline-lg text-graphite">Aparência</h1>
        <p className="mt-0.5 text-body-md text-text-muted">
          Logo, capa e cor de destaque são exibidos na sua loja pública, para os clientes reconhecerem sua marca.
        </p>
      </div>

      <AparenciaClient
        storeName={restaurant.name}
        banner={banner ? { isEnabled: banner.is_enabled as boolean, message: banner.message as string } : null}
        logoUrl={restaurant.logo_path ? getPublicAssetUrl(supabase, restaurant.logo_path) : null}
        coverUrl={restaurant.cover_path ? getPublicAssetUrl(supabase, restaurant.cover_path) : null}
        themePrimaryColor={restaurant.theme_primary_color}
      />
    </div>
  );
}
