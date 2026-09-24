import { redirect } from "next/navigation";
import { getAuthedUser, getMyRestaurant, getPlatformSettings } from "@/lib/tenant";
import { getSetupChecklist } from "@/lib/setup";
import { SetupChecklistCard } from "@/components/painel/SetupChecklistCard";
import { AjudaClient } from "@/components/painel/ajuda/AjudaClient";

export default async function AjudaPage() {
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const [checklist, settings] = await Promise.all([
    getSetupChecklist(supabase, restaurant),
    getPlatformSettings(supabase),
  ]);

  return (
    <AjudaClient
      hasChecklistSlot={<SetupChecklistCard checklist={checklist} storeSlug={restaurant.slug} />}
      supportEmail={settings.support_email}
      supportWhatsapp={settings.support_whatsapp}
    />
  );
}
