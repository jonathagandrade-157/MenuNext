import { redirect } from "next/navigation";
import { getAuthedUser, getMyRestaurant, getCategories } from "@/lib/tenant";
import { CategoriasClient } from "@/components/painel/categorias/CategoriasClient";

export default async function CategoriasPage() {
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const categories = await getCategories(supabase, restaurant.id);

  return <CategoriasClient initialCategories={categories} />;
}
