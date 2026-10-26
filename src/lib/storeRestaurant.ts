import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getPublicRestaurantBySlug, type PublicRestaurant } from "@/lib/store";

/**
 * Restaurante público pelo slug, uma única consulta por requisição: o layout (que decide o 404 antes de a
 * página começar a ser enviada), o título da aba e a própria página pedem o mesmo dado e compartilham este resultado.
 */
export const getCachedPublicRestaurant = cache(async (slug: string): Promise<PublicRestaurant | null> => {
  const supabase = await createClient();
  return getPublicRestaurantBySlug(supabase, slug);
});
