"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMyRestaurant, type Restaurant } from "@/lib/tenant";
import { WEEK_DAYS, type HorariosActionState } from "@/lib/form-state";

const HORARIOS_PATH = "/painel/horarios";

async function requireRestaurant(): Promise<{ supabase: SupabaseClient; restaurant: Restaurant }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  return { supabase, restaurant };
}

/**
 * Edição de horários de funcionamento (separação onboarding/painel) — mesma
 * validação e mesmo upsert em business_hours do Passo 5 do onboarding
 * (savePasso5Action, src/lib/actions/onboarding.ts), mas sem chamar
 * advanceStep(): ao salvar, permanece em /painel/horarios.
 */
export async function saveHorariosConfigAction(
  _prev: HorariosActionState,
  formData: FormData
): Promise<HorariosActionState> {
  const { supabase, restaurant } = await requireRestaurant();

  const rows = WEEK_DAYS.map(({ value }) => {
    const isOpen = formData.get(`is_open_${value}`) === "on";
    const opensAt = String(formData.get(`opens_at_${value}`) ?? "");
    const closesAt = String(formData.get(`closes_at_${value}`) ?? "");
    return {
      restaurant_id: restaurant.id,
      day_of_week: value,
      is_open: isOpen,
      opens_at: isOpen && opensAt ? opensAt : null,
      closes_at: isOpen && closesAt ? closesAt : null,
    };
  });

  const anyOpenMissingHours = rows.some((row) => row.is_open && (!row.opens_at || !row.closes_at));
  if (anyOpenMissingHours) {
    return { status: "error", message: "Informe horário de abertura e fechamento para os dias abertos." };
  }

  const { error } = await supabase.from("business_hours").upsert(rows, { onConflict: "restaurant_id,day_of_week" });
  if (error) return { status: "error", message: "Não foi possível salvar os horários. Tente novamente." };

  revalidatePath(HORARIOS_PATH);
  revalidatePath("/painel");
  return { status: "success" };
}
