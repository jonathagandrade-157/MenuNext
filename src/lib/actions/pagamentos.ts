"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMyRestaurant, type Restaurant } from "@/lib/tenant";
import type { PagamentosActionState } from "@/lib/form-state";
import type { PixKeyType } from "@/lib/pix";

const PIX_KEY_TYPES: PixKeyType[] = ["cpf_cnpj", "email", "telefone", "aleatoria"];

const PAGAMENTOS_PATH = "/painel/pagamentos";

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
 * Edição de formas de pagamento (separação onboarding/painel) — mesma
 * validação e mesma persistência do Passo 6 do onboarding (savePasso6Action,
 * src/lib/actions/onboarding.ts), mas sem chamar advanceStep(): ao salvar,
 * permanece em /painel/pagamentos.
 */
export async function savePagamentosConfigAction(
  _prev: PagamentosActionState,
  formData: FormData
): Promise<PagamentosActionState> {
  const { supabase, restaurant } = await requireRestaurant();

  const paymentPix = formData.get("payment_pix") === "on";
  const paymentCash = formData.get("payment_cash") === "on";
  const paymentCard = formData.get("payment_card") === "on";
  const pixKey = String(formData.get("payment_pix_key") ?? "").trim();
  const pixKeyTypeRaw = String(formData.get("payment_pix_key_type") ?? "");
  const pixKeyType = PIX_KEY_TYPES.includes(pixKeyTypeRaw as PixKeyType) ? (pixKeyTypeRaw as PixKeyType) : null;
  const pixHolderName = String(formData.get("payment_pix_holder_name") ?? "").trim();
  const pixCity = String(formData.get("payment_pix_city") ?? "").trim();

  if (!paymentPix && !paymentCash && !paymentCard) {
    return { status: "error", message: "Selecione ao menos uma forma de pagamento." };
  }
  if (paymentPix && !pixKey) {
    return { status: "error", message: "Informe a chave Pix do restaurante." };
  }
  if (paymentPix && (!pixHolderName || !pixCity)) {
    return { status: "error", message: "Informe o nome do titular e a cidade da conta para gerar o QR Code Pix." };
  }

  const { error } = await supabase
    .from("restaurants")
    .update({
      payment_pix: paymentPix,
      payment_pix_key: paymentPix ? pixKey : null,
      payment_pix_key_type: paymentPix ? pixKeyType : null,
      payment_pix_holder_name: paymentPix ? pixHolderName : null,
      payment_pix_city: paymentPix ? pixCity : null,
      payment_cash: paymentCash,
      payment_card: paymentCard,
    })
    .eq("id", restaurant.id);
  if (error) return { status: "error", message: "Não foi possível salvar. Tente novamente." };

  revalidatePath(PAGAMENTOS_PATH);
  revalidatePath("/painel");
  return { status: "success" };
}
