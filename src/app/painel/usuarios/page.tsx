import { getAuthedUser, requireOwnerPage, getRestaurantMembers, getRestaurantInvites } from "@/lib/tenant";
import { UsuariosClient } from "@/components/painel/usuarios/UsuariosClient";
import { getRestaurantAudit } from "@/lib/audit";

// Restrita ao OWNER (JON-10): gestão de equipe/convites fica fora do
// escopo operacional/cardápio liberado para STAFF.
export default async function UsuariosPage() {
  const { supabase, restaurant } = await requireOwnerPage();
  const { user } = await getAuthedUser();

  const [members, invites, activity] = await Promise.all([
    getRestaurantMembers(supabase),
    getRestaurantInvites(supabase, restaurant.id),
    getRestaurantAudit(supabase, 15),
  ]);

  return <UsuariosClient members={members} invites={invites} currentUserId={user!.id} activity={activity} />;
}
