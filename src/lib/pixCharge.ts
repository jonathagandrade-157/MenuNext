import type { SupabaseClient } from "@supabase/supabase-js";

/** O que o cliente vê da cobrança Pix do próprio pedido (get_order_pix_charge). */
/**
 * creating = gerando a cobrança (resposta do provedor ainda indefinida: NÃO mostrar a chave Pix comum);
 * pending = QR na tela; approved = pago (conferido no Mercado Pago); cancelled/expired/failed = sem cobrança
 * automática válida — o cliente pode pagar pela chave Pix da loja, que a loja confere manualmente.
 */
export type PublicPixCharge = {
  status: "creating" | "pending" | "approved" | "cancelled" | "expired" | "failed";
  qrCode: string | null;
  amount: number;
  expiresAt: string | null;
  approvedAt: string | null;
};

const STATUSES = new Set(["creating", "pending", "approved", "cancelled", "expired", "failed"]);

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
export type PixSettingsStatus = {
  available: boolean;
  configured: boolean;
  enabled: boolean;
  tokenHint: string | null;
  webhookSecretConfigured: boolean;
};

export async function readPixSettingsStatus(supabase: SupabaseClient, restaurantId: string): Promise<PixSettingsStatus> {
  const { data, error } = await supabase.rpc("pix_settings_status", { p_restaurant: restaurantId });
  if (error) return { available: false, configured: false, enabled: false, tokenHint: null, webhookSecretConfigured: false };
  const row = (data as Record<string, unknown>[] | null)?.[0];
  return {
    available: true,
    configured: row?.configured === true,
    enabled: row?.enabled === true,
    tokenHint: typeof row?.token_hint === "string" ? row.token_hint : null,
    webhookSecretConfigured: row?.webhook_secret_configured === true,
  };
}

/**
 * Linha do painel sobre o Pix de um pedido. Só "approved" foi conferido pelo Mercado Pago; em todos os outros
 * casos em que o cliente pode ter pago pela chave Pix comum, o painel pede conferência manual no extrato.
 */
export function describePanelPixStatus(status: string | null): { tone: "success" | "info" | "warning"; text: string } {
  switch (status) {
    case "approved":
      return { tone: "success", text: "Pix automático confirmado pelo Mercado Pago." };
    case "pending":
      return { tone: "info", text: "Pix automático: aguardando o cliente pagar o QR Code." };
    case "creating":
      return { tone: "info", text: "Pix automático: gerando a cobrança." };
    case "failed":
    case "cancelled":
    case "expired":
      return { tone: "warning", text: "Pix automático não concluído. Se o cliente pagou pela chave Pix, confira no extrato antes de liberar." };
    default:
      return { tone: "warning", text: "Pix pela chave da loja: confira o pagamento no extrato antes de liberar." };
  }
}
