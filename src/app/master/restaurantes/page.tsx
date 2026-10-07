import { requireMasterPage } from "@/lib/tenant";
import { getMasterRestaurants, parseListParams } from "@/lib/masterRestaurants";
import { RestaurantsListView } from "@/components/master/RestaurantsListView";

export default async function Page(props: PageProps<"/master/restaurantes">) {
  const { supabase } = await requireMasterPage();

  const params = parseListParams(await props.searchParams);
  const { rows, total } = await getMasterRestaurants(supabase, params);

  return <RestaurantsListView rows={rows} total={total} params={params} />;
}
