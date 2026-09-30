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

const MAX_PERIODS_PER_DAY = 3;

/**
 * Edição de horários de funcionamento — cada dia pode ter até
 * MAX_PERIODS_PER_DAY períodos (ex.: almoço/jantar com intervalo fechado,
 * área "Horários" do redesign). Um dia fechado é representado pela
 * ausência de linhas, nunca um boolean is_open (removido na migration
 * add_business_hours_periods) — por isso salvar substitui TODAS as linhas
 * do restaurante (delete + insert) em vez de upsert por chave, que exigiria
 * calcular quais period_order remover quando o lojista reduz o número de
 * turnos de um dia.
 *
 * Diferente do onboarding (Passo 5, savePasso5Action em
 * src/lib/actions/onboarding.ts) — este é só o único ponto que já
 * escreve/lê múltiplos períodos; o onboarding continua salvando 1 período
 * por dia, decisão de escopo para não reescrever aquela UI.
 */
export async function saveHorariosConfigAction(
  _prev: HorariosActionState,
  formData: FormData
): Promise<HorariosActionState> {
  const { supabase, restaurant } = await requireRestaurant();

  const rows: { restaurant_id: string; day_of_week: number; period_order: number; opens_at: string; closes_at: string }[] = [];

  for (const { value, label } of WEEK_DAYS) {
    const isOpen = formData.get(`is_open_${value}`) === "on";
    if (!isOpen) continue;

    const periodCount = Math.min(Number(formData.get(`period_count_${value}`) ?? 1) || 1, MAX_PERIODS_PER_DAY);
    for (let period = 1; period <= periodCount; period++) {
      const opensAt = String(formData.get(`opens_at_${value}_${period}`) ?? "");
      const closesAt = String(formData.get(`closes_at_${value}_${period}`) ?? "");
      if (!opensAt || !closesAt) {
        return { status: "error", message: `Informe abertura e fechamento de todos os períodos de ${label}.` };
      }
      rows.push({ restaurant_id: restaurant.id, day_of_week: value, period_order: period, opens_at: opensAt, closes_at: closesAt });
    }
  }

  const { error: deleteError } = await supabase.from("business_hours").delete().eq("restaurant_id", restaurant.id);
  if (deleteError) return { status: "error", message: "Não foi possível salvar os horários. Tente novamente." };

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from("business_hours").insert(rows);
    if (insertError) return { status: "error", message: "Não foi possível salvar os horários. Tente novamente." };
  }

  revalidatePath(HORARIOS_PATH);
  revalidatePath("/painel");
  return { status: "success" };
}
