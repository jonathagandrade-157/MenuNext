import { notFound } from "next/navigation";
import { requireMasterPage } from "@/lib/tenant";
import { getMasterRestaurant } from "@/lib/masterRestaurants";
import { RestaurantDetailView } from "@/components/master/RestaurantDetailView";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page(props: PageProps<"/master/restaurantes/[id]">) {
  const { supabase } = await requireMasterPage();

  // Um id que não é UUID faria o Postgres lançar erro de cast (500); aqui
  // vira 404 como qualquer restaurante inexistente.
  const { id } = await props.params;
  if (!UUID_PATTERN.test(id)) notFound();

  const detail = await getMasterRestaurant(supabase, id);
  if (!detail) notFound();

  return <RestaurantDetailView detail={detail} />;
}
