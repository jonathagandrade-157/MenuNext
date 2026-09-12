"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMyRestaurant, type Restaurant } from "@/lib/tenant";

const DELIVERY_PATH = "/painel/delivery";

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

export type DeliveryConfigActionState = { status: "idle" | "success" | "error"; message?: string };
export const initialDeliveryConfigState: DeliveryConfigActionState = { status: "idle" };

/** Retorna null para vazio, NaN para "preenchido mas inválido" — para os dois
 * casos serem distinguíveis na validação abaixo. */
function parseOptionalDecimal(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : NaN;
}

/**
 * Configuração consolidada de delivery (Fase 4.1) — reaproveita
 * service_delivery/delivery_fee/delivery_radius_km (já existiam desde o
 * onboarding, Passo 3/4) e adiciona pedido mínimo + tempo estimado de
 * entrega, os dois únicos campos realmente novos desta fase. Horários
 * continuam vivendo só em business_hours (/onboarding/passo-5) — não
 * duplicados aqui, apenas linkados. Ligar/desligar o delivery aqui nunca
 * apaga taxa/raio/pedido mínimo já configurados: o lojista pode desativar
 * temporariamente sem perder a configuração.
 */
export async function saveDeliveryConfigAction(
  _prev: DeliveryConfigActionState,
  formData: FormData
): Promise<DeliveryConfigActionState> {
  const { supabase, restaurant } = await requireRestaurant();

  const serviceDelivery = formData.get("service_delivery") === "on";
  const feeRaw = String(formData.get("delivery_fee") ?? "");
  const radiusRaw = String(formData.get("delivery_radius_km") ?? "");
  const minOrderRaw = String(formData.get("minimum_order_value") ?? "");
  const estMinRaw = String(formData.get("estimated_delivery_min_minutes") ?? "").trim();
  const estMaxRaw = String(formData.get("estimated_delivery_max_minutes") ?? "").trim();

  const fee = parseOptionalDecimal(feeRaw);
  const radius = parseOptionalDecimal(radiusRaw);
  const minOrder = parseOptionalDecimal(minOrderRaw);
  const estMin = estMinRaw === "" ? null : Number(estMinRaw);
  const estMax = estMaxRaw === "" ? null : Number(estMaxRaw);

  if (serviceDelivery) {
    if (fee === null || Number.isNaN(fee) || fee < 0) {
      return { status: "error", message: "Informe uma taxa de entrega válida." };
    }
    if (radius === null || Number.isNaN(radius) || radius <= 0) {
      return { status: "error", message: "Informe um raio de entrega válido." };
    }
  } else {
    if (Number.isNaN(fee) || Number.isNaN(radius)) {
      return { status: "error", message: "Verifique a taxa e o raio de entrega informados." };
    }
  }

  if (Number.isNaN(minOrder) || (minOrder !== null && minOrder < 0)) {
    return { status: "error", message: "Informe um pedido mínimo válido." };
  }

  if ((estMin === null) !== (estMax === null)) {
    return { status: "error", message: "Informe o tempo estimado mínimo e máximo, ou deixe os dois em branco." };
  }
  if (estMin !== null && estMax !== null) {
    if (!Number.isInteger(estMin) || !Number.isInteger(estMax) || estMin < 0 || estMax < 0) {
      return { status: "error", message: "O tempo estimado de entrega deve ser em minutos inteiros." };
    }
    if (estMax < estMin) {
      return { status: "error", message: "O tempo máximo estimado deve ser maior ou igual ao mínimo." };
    }
  }

  const { error } = await supabase
    .from("restaurants")
    .update({
      service_delivery: serviceDelivery,
      delivery_fee: fee,
      delivery_radius_km: radius,
      minimum_order_value: minOrder,
      estimated_delivery_min_minutes: estMin,
      estimated_delivery_max_minutes: estMax,
    })
    .eq("id", restaurant.id);
  if (error) return { status: "error", message: "Não foi possível salvar. Tente novamente." };

  revalidatePath(DELIVERY_PATH);
  revalidatePath("/painel");
  return { status: "success" };
}
