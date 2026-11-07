import type { SupabaseClient } from "@supabase/supabase-js";

/** O que o cliente vê da cobrança Pix do próprio pedido (get_order_pix_charge). */
export type PublicPixCharge = {
  status: "pending" | "approved" | "cancelled" | "expired";
  qrCode: string | null;
  amount: number;
  expiresAt: string | null;
  approvedAt: string | null;
};

const STATUSES = new Set(["pending", "approved", "cancelled", "expired"]);

/** null = sem cobrança automática (ou banco sem a migration): a página mostra a chave Pix estática de sempre. */
export async function readOrderPixCharge(supabase: SupabaseClient, slug: string, publicId: string): Promise<PublicPixCharge | null> {
  const { data, error } = await supabase.rpc("get_order_pix_charge", { p_slug: slug, p_public_id: publicId });
  // sem a migration (isMissingRpc) ou qualquer falha: sem cobrança automática, nunca quebra a página
  if (error) return null;
  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row || !STATUSES.has(String(row.status))) return null;
  return {
    status: row.status as PublicPixCharge["status"],
    qrCode: typeof row.qr_code === "string" ? row.qr_code : null,
    amount: Number(row.amount),
    expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
    approvedAt: typeof row.approved_at === "string" ? row.approved_at : null,
  };
}

/** Status do Pix automático da loja para o painel (sem o token). */
export type PixSettingsStatus = { available: boolean; configured: boolean; enabled: boolean; tokenHint: string | null };

export async function readPixSettingsStatus(supabase: SupabaseClient, restaurantId: string): Promise<PixSettingsStatus> {
  const { data, error } = await supabase.rpc("pix_settings_status", { p_restaurant: restaurantId });
  if (error) return { available: false, configured: false, enabled: false, tokenHint: null };
  const row = (data as Record<string, unknown>[] | null)?.[0];
  return {
    available: true,
    configured: row?.configured === true,
    enabled: row?.enabled === true,
    tokenHint: typeof row?.token_hint === "string" ? row.token_hint : null,
  };
}
