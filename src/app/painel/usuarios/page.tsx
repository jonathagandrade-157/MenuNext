import { redirect } from "next/navigation";
import { getAuthedUser, getMyRestaurant, getMyMembership, getRestaurantMembers, getRestaurantInvites } from "@/lib/tenant";
import { UsuariosClient } from "@/components/painel/usuarios/UsuariosClient";

export default async function UsuariosPage() {
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const membership = await getMyMembership(supabase, restaurant.id);

  const [members, invites] = await Promise.all([
    getRestaurantMembers(supabase),
    membership?.role === "OWNER" ? getRestaurantInvites(supabase, restaurant.id) : Promise.resolve([]),
  ]);

  return (
    <UsuariosClient members={members} invites={invites} currentUserId={user.id} isOwner={membership?.role === "OWNER"} />
  );
}
