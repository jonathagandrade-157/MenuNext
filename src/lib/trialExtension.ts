import type { SupabaseClient } from "@supabase/supabase-js";

/** Prazos oferecidos ao master na cortesia de trial (dias). */
export const TRIAL_EXTENSION_OPTIONS = [7, 15, 30, 60] as const;

/** Valor do formulário -> dias válidos, ou null. Só aceita os prazos oferecidos. */
export function parseExtensionDays(raw: unknown): number | null {
  const days = Number(raw);
  return (TRIAL_EXTENSION_OPTIONS as readonly number[]).includes(days) ? days : null;
}

export type TrialSummary =
  | { state: "none" }
  | { state: "active"; endsAt: string; daysLeft: number }
  | { state: "expired"; endsAt: string };

/** Situação do trial do OWNER. `none` = nunca teve trial (ex.: documento já
 * usado em outro cadastro). `daysLeft` arredonda para cima: faltando 2 horas,
 * ainda é 1 dia. */
export function summarizeTrial(endsAt: string | null, now: Date): TrialSummary {
  if (!endsAt) return { state: "none" };
  const remainingMs = new Date(endsAt).getTime() - now.getTime();
  if (remainingMs <= 0) return { state: "expired", endsAt };
  return { state: "active", endsAt, daysLeft: Math.ceil(remainingMs / 86_400_000) };
}

export async function getMasterRestaurantTrialEnd(supabase: SupabaseClient, restaurantId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("master_get_restaurant_trial", { p_restaurant_id: restaurantId });
  if (error) throw error;
  return (data as string | null) ?? null;
}
