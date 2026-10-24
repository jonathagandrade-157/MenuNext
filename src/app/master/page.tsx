import { requireMasterPage } from "@/lib/tenant";
import { getMasterDashboardStats } from "@/lib/masterDashboard";
import { getMasterRestaurants } from "@/lib/masterRestaurants";
import { MasterDashboardView } from "@/components/master/MasterDashboardView";

const OVERDUE_PREVIEW_SIZE = 5;
const RECENT_PREVIEW_SIZE = 5;

export default async function Page() {
  const { supabase } = await requireMasterPage();

  const [stats, overdue, recent] = await Promise.all([
    getMasterDashboardStats(supabase),
    getMasterRestaurants(supabase, { search: null, subscriptionStatus: "overdue", page: 1 }),
    // A lista vem do mais novo para o mais antigo: a primeira página já são os recentes.
    getMasterRestaurants(supabase, { search: null, subscriptionStatus: null, page: 1 }),
  ]);

  return (
    <MasterDashboardView
      stats={stats}
      overdue={overdue.rows.slice(0, OVERDUE_PREVIEW_SIZE)}
      overdueTotal={overdue.total}
      recent={recent.rows.slice(0, RECENT_PREVIEW_SIZE)}
    />
  );
}
