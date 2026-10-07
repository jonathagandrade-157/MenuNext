"use server";

import { revalidatePath } from "next/cache";
import { requireMasterPage } from "@/lib/tenant";
import type { PlanActionState } from "@/lib/form-state";

const ASSINATURAS_PATH = "/master/assinaturas";

function parseOptionalDecimal(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : NaN;
}

function friendlyPlanError(message: string): string {
  if (message.toLowerCase().includes("duplicate key")) {
    return "Já existe um plano com esse nome.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

type PlanFormData = {
  name: string;
  description: string | null;
  price: number;
};

function readPlanForm(formData: FormData): { ok: true; data: PlanFormData } | { ok: false; error: string } {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const priceRaw = String(formData.get("price") ?? "");

  if (!name || name.length > 60) {
    return { ok: false, error: "Informe um nome de plano de até 60 caracteres." };
  }

  const price = parseOptionalDecimal(priceRaw);
  if (price === null || Number.isNaN(price) || price < 0) {
    return { ok: false, error: "Informe um preço mensal válido." };
  }

  return { ok: true, data: { name, description: description || null, price } };
}

export async function createPlanAction(_prev: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const { supabase } = await requireMasterPage();

  const result = readPlanForm(formData);
  if (!result.ok) return { status: "error", message: result.error };

  const { error } = await supabase.from("plans").insert(result.data);
  if (error) return { status: "error", message: friendlyPlanError(error.message) };

  revalidatePath(ASSINATURAS_PATH);
  return { status: "success" };
}

export async function updatePlanAction(_prev: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const { supabase } = await requireMasterPage();

  const planId = String(formData.get("planId") ?? "");
  if (!planId) return { status: "error", message: "Plano inválido." };

  const result = readPlanForm(formData);
  if (!result.ok) return { status: "error", message: result.error };

  const { data: updated, error } = await supabase.from("plans").update(result.data).eq("id", planId).select("id");
  if (error) return { status: "error", message: friendlyPlanError(error.message) };
  if (!updated || updated.length === 0) return { status: "error", message: "Plano não encontrado." };

  revalidatePath(ASSINATURAS_PATH);
  return { status: "success" };
}

export async function togglePlanActiveAction(planId: string, nextActive: boolean): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireMasterPage();

  const { data, error } = await supabase.from("plans").update({ is_active: nextActive }).eq("id", planId).select("id");
  if (error) return { ok: false, error: "Não foi possível atualizar. Tente novamente." };
  if (!data || data.length === 0) return { ok: false, error: "Plano não encontrado." };

  revalidatePath(ASSINATURAS_PATH);
  return { ok: true };
}

export async function deletePlanAction(planId: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireMasterPage();

  const { data, error } = await supabase.from("plans").delete().eq("id", planId).select("id");
  if (error) return { ok: false, error: "Não foi possível excluir. Verifique se nenhum restaurante está nesse plano." };
  if (!data || data.length === 0) return { ok: false, error: "Plano não encontrado." };

  revalidatePath(ASSINATURAS_PATH);
  return { ok: true };
}

export async function updateBillingSettingsAction(
  _prev: PlanActionState,
  formData: FormData
): Promise<PlanActionState> {
  const { supabase } = await requireMasterPage();

  const token = String(formData.get("asaasWebhookToken") ?? "").trim();

  const { error } = await supabase.rpc("update_billing_settings", { p_asaas_webhook_token: token || null });
  if (error) return { status: "error", message: "Não foi possível salvar. Tente novamente." };

  revalidatePath(ASSINATURAS_PATH);
  return { status: "success" };
}
