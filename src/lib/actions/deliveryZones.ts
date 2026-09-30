"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMyRestaurant, type Restaurant } from "@/lib/tenant";
import type { DeliveryZoneActionState } from "@/lib/form-state";

const DELIVERY_PATH = "/painel/delivery";
const NEIGHBORHOOD_MAX_LENGTH = 80;

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

/** null para vazio, NaN para "preenchido mas inválido" — mesmo padrão de
 * parseOptionalDecimal em actions/delivery.ts. */
function parseOptionalDecimal(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : NaN;
}

function friendlyZoneError(message: string): string {
  if (message.toLowerCase().includes("duplicate key")) {
    return "Já existe uma zona cadastrada para esse bairro.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

type ZoneFormData = {
  neighborhood: string;
  delivery_fee: number;
  minimum_order_value: number | null;
  estimated_time_min_minutes: number | null;
  estimated_time_max_minutes: number | null;
};

function readZoneForm(formData: FormData): { ok: true; data: ZoneFormData } | { ok: false; error: string } {
  const neighborhood = String(formData.get("neighborhood") ?? "").trim();
  const feeRaw = String(formData.get("delivery_fee") ?? "");
  const minOrderRaw = String(formData.get("minimum_order_value") ?? "");
  const estMinRaw = String(formData.get("estimated_time_min_minutes") ?? "").trim();
  const estMaxRaw = String(formData.get("estimated_time_max_minutes") ?? "").trim();

  if (!neighborhood || neighborhood.length > NEIGHBORHOOD_MAX_LENGTH) {
    return { ok: false, error: `Informe o nome do bairro (até ${NEIGHBORHOOD_MAX_LENGTH} caracteres).` };
  }

  const fee = parseOptionalDecimal(feeRaw);
  if (fee === null || Number.isNaN(fee) || fee < 0) {
    return { ok: false, error: "Informe uma taxa de entrega válida para o bairro." };
  }

  const minOrder = parseOptionalDecimal(minOrderRaw);
  if (Number.isNaN(minOrder) || (minOrder !== null && minOrder < 0)) {
    return { ok: false, error: "Informe um pedido mínimo válido." };
  }

  const estMin = estMinRaw === "" ? null : Number(estMinRaw);
  const estMax = estMaxRaw === "" ? null : Number(estMaxRaw);
  if ((estMin === null) !== (estMax === null)) {
    return { ok: false, error: "Informe o tempo estimado mínimo e máximo, ou deixe os dois em branco." };
  }
  if (estMin !== null && estMax !== null) {
    if (!Number.isInteger(estMin) || !Number.isInteger(estMax) || estMin < 0 || estMax < 0 || estMax < estMin) {
      return { ok: false, error: "Verifique o tempo estimado de entrega do bairro." };
    }
  }

  return {
    ok: true,
    data: {
      neighborhood,
      delivery_fee: fee,
      minimum_order_value: minOrder,
      estimated_time_min_minutes: estMin,
      estimated_time_max_minutes: estMax,
    },
  };
}

export async function createDeliveryZoneAction(
  _prev: DeliveryZoneActionState,
  formData: FormData
): Promise<DeliveryZoneActionState> {
  const { supabase, restaurant } = await requireRestaurant();

  const result = readZoneForm(formData);
  if (!result.ok) return { status: "error", message: result.error };

  const { error } = await supabase.from("delivery_zones").insert({ ...result.data, restaurant_id: restaurant.id });
  if (error) return { status: "error", message: friendlyZoneError(error.message) };

  revalidatePath(DELIVERY_PATH);
  return { status: "success" };
}

export async function updateDeliveryZoneAction(
  _prev: DeliveryZoneActionState,
  formData: FormData
): Promise<DeliveryZoneActionState> {
  const { supabase } = await requireRestaurant();

  const zoneId = String(formData.get("zoneId") ?? "");
  if (!zoneId) return { status: "error", message: "Zona inválida." };

  const result = readZoneForm(formData);
  if (!result.ok) return { status: "error", message: result.error };

  const { data: updated, error } = await supabase.from("delivery_zones").update(result.data).eq("id", zoneId).select("id");
  if (error) return { status: "error", message: friendlyZoneError(error.message) };
  if (!updated || updated.length === 0) return { status: "error", message: "Zona não encontrada." };

  revalidatePath(DELIVERY_PATH);
  return { status: "success" };
}

export async function toggleDeliveryZoneActiveAction(zoneId: string, nextActive: boolean): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { data, error } = await supabase.from("delivery_zones").update({ is_active: nextActive }).eq("id", zoneId).select("id");
  if (error) return { ok: false, error: "Não foi possível atualizar. Tente novamente." };
  if (!data || data.length === 0) return { ok: false, error: "Zona não encontrada." };

  revalidatePath(DELIVERY_PATH);
  return { ok: true };
}

export async function deleteDeliveryZoneAction(zoneId: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireRestaurant();

  const { data, error } = await supabase.from("delivery_zones").delete().eq("id", zoneId).select("id");
  if (error) return { ok: false, error: "Não foi possível excluir. Tente novamente." };
  if (!data || data.length === 0) return { ok: false, error: "Zona não encontrada." };

  revalidatePath(DELIVERY_PATH);
  return { ok: true };
}
