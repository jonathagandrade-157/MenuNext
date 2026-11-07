/**
 * Orquestra o Pix automático no SERVIDOR: cria a cobrança de um pedido e sincroniza o estado com o Mercado Pago.
 * Usa o cliente service_role SOMENTE pelas RPCs pix_*_backend (nunca from(...) livre). Nunca lança para quem
 * chama: qualquer falha vira um resultado, e o pedido continua valendo com a chave Pix estática da loja.
 * Nenhum token, QR ou dado do pagador vai para log.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createMercadoPagoPixPayment,
  getMercadoPagoPixPayment,
  getPixAutoConfig,
  pixExpiration,
  type PixAutoConfig,
  type PixStatus,
} from "./pixAuto";
import { openSecret } from "./secretBox";
import { createAdminClient } from "./supabase/admin";

export type EnsureChargeResult = "created" | "exists" | "unavailable" | "failed";
export type SyncResult = { status: PixStatus } | { status: "skipped" | "unavailable" | "failed" };

type Deps = { admin: SupabaseClient; config: PixAutoConfig; now?: () => Date };

async function defaultDeps(): Promise<Deps | null> {
  const config = getPixAutoConfig();
  if (!config) return null;
  return { admin: createAdminClient(), config };
}

type ContextRow = {
  order_id: string;
  restaurant_id: string;
  order_number: number;
  total: number | string;
  restaurant_name: string;
  token_ciphertext: string;
  has_charge: boolean;
};

/** Cria a cobrança Pix do pedido, se a loja tem o recurso LIGADO e o pedido é Pix sem cobrança. Idempotente. */
export async function ensurePixCharge(slug: string, publicId: string, deps?: Deps): Promise<EnsureChargeResult> {
  try {
    const d = deps ?? (await defaultDeps());
    if (!d) return "unavailable";
    const { data, error } = await d.admin.rpc("pix_charge_context_backend", { p_slug: slug, p_public_id: publicId });
    if (error) return "failed";
    const ctx = (data as ContextRow[] | null)?.[0];
    if (!ctx) return "unavailable";
    if (ctx.has_charge) return "exists";

    const token = openSecret(ctx.token_ciphertext, ctx.restaurant_id, d.config.encryptionKey);
    if (!token) return "failed";
    const total = Math.round(Number(ctx.total) * 100) / 100;
    if (!(total > 0)) return "failed";

    const now = (d.now ?? (() => new Date()))();
    const created = await createMercadoPagoPixPayment(token, {
      amount: total,
      description: `Pedido #${ctx.order_number} - ${ctx.restaurant_name}`,
      orderPublicId: publicId,
      payerEmail: d.config.payerEmail,
      expiresAt: pixExpiration(now),
      notificationUrl: d.config.webhookUrl,
    });
    if (!created.ok) return "failed";
    const p = created.payment;
    // a resposta tem de ser exatamente a cobrança pedida
    if (p.amount !== total || p.externalReference !== publicId || !p.qrCode) return "failed";

    const { error: regError } = await d.admin.rpc("pix_charge_register_backend", {
      p_order: ctx.order_id,
      p_provider_payment_id: p.id,
      p_amount: total,
      p_qr_code: p.qrCode,
      p_expires_at: p.expiresAt,
    });
    if (regError) return /charge_exists/.test(regError.message ?? "") ? "exists" : "failed";
    return "created";
  } catch {
    return "failed";
  }
}

type SyncRow = { charge_id: string; restaurant_id: string; provider_payment_id: string; status: string; amount: number | string; order_public_id: string; token_ciphertext: string };

/**
 * Consulta o pagamento NO MERCADO PAGO e aplica no banco. `target` é o id do provedor (webhook) ou o pedido
 * (página do pedido). Com intervalo mínimo, consultas repetidas em sequência viram "skipped".
 */
export async function syncPixCharge(
  target: { providerPaymentId: string } | { slug: string; publicId: string },
  minIntervalSeconds: number,
  deps?: Deps
): Promise<SyncResult> {
  try {
    const d = deps ?? (await defaultDeps());
    if (!d) return { status: "unavailable" };
    const { data, error } = await d.admin.rpc("pix_charge_for_sync_backend", {
      p_provider_payment_id: "providerPaymentId" in target ? target.providerPaymentId : null,
      p_slug: "slug" in target ? target.slug : null,
      p_public_id: "publicId" in target ? target.publicId : null,
      p_min_interval_seconds: minIntervalSeconds,
    });
    if (error) return { status: "failed" };
    const row = (data as SyncRow[] | null)?.[0];
    if (!row) return { status: "skipped" };

    const token = openSecret(row.token_ciphertext, row.restaurant_id, d.config.encryptionKey);
    if (!token) return { status: "failed" };

    const fetched = await getMercadoPagoPixPayment(token, row.provider_payment_id);
    if (!fetched.ok || fetched.payment.id !== row.provider_payment_id) return { status: "failed" };

    const { data: applied, error: applyError } = await d.admin.rpc("pix_charge_apply_backend", {
      p_provider_payment_id: row.provider_payment_id,
      p_status: fetched.payment.status,
      p_amount: fetched.payment.amount,
      p_external_reference: fetched.payment.externalReference,
    });
    if (applyError) return { status: "failed" };
    return { status: (applied as PixStatus) ?? "pending" };
  } catch {
    return { status: "failed" };
  }
}

