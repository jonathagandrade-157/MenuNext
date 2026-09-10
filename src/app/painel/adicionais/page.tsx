import { redirect } from "next/navigation";
import { getAddonGroupsWithAddons, getAuthedUser, getMyRestaurant } from "@/lib/tenant";
import { AdicionaisClient } from "@/components/painel/adicionais/AdicionaisClient";

export default async function AdicionaisPage() {
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const groups = await getAddonGroupsWithAddons(supabase, restaurant.id);

  return <AdicionaisClient initialGroups={groups} />;
}
