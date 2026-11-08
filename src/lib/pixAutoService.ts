/**
 * Orquestra o Pix automático no SERVIDOR: cria a cobrança de um pedido e sincroniza o estado com o Mercado Pago.
 * Usa o cliente service_role SOMENTE pelas RPCs pix_*_backend (nunca from(...) livre). Nunca lança para quem
 * chama. Nenhum token, segredo, QR ou dado do pagador vai para log.
 *
 * Criação em 3 passos, à prova de resposta indefinida:
 *   1. reserva no banco ('creating', total do banco, uma tentativa por vez);
 *   2. POST no Mercado Pago com idempotência pelo pedido (repetir devolve o MESMO pagamento);
 *   3. registro ('pending') — só então o cliente vê o QR.
 * Indefinida (rede/5xx): fica 'creating' e é tentada de novo; a página NÃO mostra a chave Pix comum nesse meio
 * tempo. Definitiva (4xx): 'failed' — chave Pix comum com conferência manual (nenhum QR automático foi mostrado).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyMercadoPagoSignature } from "./mercadopagoWebhook";
import {
  createMercadoPagoPixPayment,
  getMercadoPagoPixPayment,
  getPixAutoConfig,
  isDefinitiveFailure,
  pixExpiration,
  type PixAutoConfig,
  type PixStatus,
} from "./pixAuto";
import { openSecret } from "./secretBox";
import { createAdminClient } from "./supabase/admin";

export const PIX_CREATE_RETRY_AFTER_SECONDS = 8;
/** Depois de tantas tentativas indefinidas, desiste (a cobrança, se existir, nunca foi mostrada e vence sozinha). */
export const PIX_CREATE_MAX_ATTEMPTS = 6;

export type EnsureChargeResult = "created" | "creating" | "busy" | "failed" | "unavailable";
export type SyncResult = { status: PixStatus } | { status: "skipped" | "unavailable" | "failed" | "unauthorized" };

type Deps = { admin: SupabaseClient; config: PixAutoConfig; now?: () => Date };

async function defaultDeps(): Promise<Deps | null> {
  const config = getPixAutoConfig();
  if (!config) return null;
  return { admin: createAdminClient(), config };
}

/** Contexto do texto cifrado (dado autenticado): o token de uma loja não decifra como de outra. */
export const tokenContext = (restaurantId: string) => restaurantId;
export const webhookSecretContext = (restaurantId: string) => `${restaurantId}:webhook`;

type BeginRow = {
  charge_id: string;
  restaurant_id: string;
  order_number: number;
  amount: number | string;
  restaurant_name: string;
  token_ciphertext: string;
  collector_id: string;
  attempts: number;
};

async function fail(d: Deps, chargeId: string, reason: string): Promise<"failed"> {
  await d.admin.rpc("pix_charge_fail_backend", { p_charge: chargeId, p_reason: reason });
  return "failed";
}

/** Cria (ou retoma a criação de) a cobrança Pix do pedido. Idempotente; nunca lança. */
export async function ensurePixCharge(slug: string, publicId: string, deps?: Deps): Promise<EnsureChargeResult> {
  try {
    const d = deps ?? (await defaultDeps());
    if (!d) return "unavailable";
    const { data, error } = await d.admin.rpc("pix_charge_begin_backend", {
      p_slug: slug,
      p_public_id: publicId,
      p_retry_after_seconds: PIX_CREATE_RETRY_AFTER_SECONDS,
    });
    if (error) return "creating"; // banco indisponível agora: nada foi decidido
    const row = (data as BeginRow[] | null)?.[0];
    if (!row) return "busy"; // sem recurso, já criada, ou outra tentativa em andamento

    const token = openSecret(row.token_ciphertext, tokenContext(row.restaurant_id), d.config.encryptionKey);
    if (!token) return fail(d, row.charge_id, "token_unreadable");
    const amount = Math.round(Number(row.amount) * 100) / 100;

    const now = (d.now ?? (() => new Date()))();
    const created = await createMercadoPagoPixPayment(token, {
      amount,
      description: `Pedido #${row.order_number} - ${row.restaurant_name}`,
      orderPublicId: publicId,
      payerEmail: d.config.payerEmail,
      expiresAt: pixExpiration(now),
      notificationUrl: d.config.webhookUrl,
    });
    if (!created.ok) {
      if (isDefinitiveFailure(created)) return fail(d, row.charge_id, "provider_rejected");
      return row.attempts >= PIX_CREATE_MAX_ATTEMPTS ? fail(d, row.charge_id, "provider_unavailable") : "creating";
    }
    const p = created.payment;
    // a resposta tem de ser exatamente a cobrança pedida, na conta da loja e em reais
    if (p.amount !== amount || p.externalReference !== publicId || !p.qrCode || p.currency !== "BRL" || p.collectorId !== row.collector_id) {
      return fail(d, row.charge_id, "provider_mismatch");
    }
    const { error: regError } = await d.admin.rpc("pix_charge_register_backend", {
      p_charge: row.charge_id,
      p_provider_payment_id: p.id,
      p_amount: amount,
      p_qr_code: p.qrCode,
      p_expires_at: p.expiresAt,
    });
    return regError ? "creating" : "created";
  } catch {
    return "creating";
  }
}

type SyncRow = {
  charge_id: string;
  restaurant_id: string;
  provider_payment_id: string;
  status: string;
  amount: number | string;
  collector_id: string;
  order_public_id: string;
  token_ciphertext: string;
  webhook_secret_ciphertext: string | null;
};

export type WebhookSignature = { xSignature: string | null; xRequestId: string | null; dataId: string | null };

/**
 * Consulta o pagamento NO MERCADO PAGO e aplica no banco. `target` é o id do provedor (webhook) ou o pedido
 * (página). Webhook de loja que cadastrou a assinatura secreta só é processado com x-signature válido.
 */
export async function syncPixCharge(
  target: { providerPaymentId: string; signature?: WebhookSignature } | { slug: string; publicId: string },
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

    if ("providerPaymentId" in target && row.webhook_secret_ciphertext) {
      const secret = openSecret(row.webhook_secret_ciphertext, webhookSecretContext(row.restaurant_id), d.config.encryptionKey);
      const sig = target.signature;
      if (!secret || !sig || !verifyMercadoPagoSignature({ ...sig, secret })) return { status: "unauthorized" };
    }
    // já paga: pago é final, não há o que consultar (aviso duplicado/atrasado)
    if (row.status === "approved") return { status: "approved" };

    const token = openSecret(row.token_ciphertext, tokenContext(row.restaurant_id), d.config.encryptionKey);
    if (!token) return { status: "failed" };

    const fetched = await getMercadoPagoPixPayment(token, row.provider_payment_id);
    if (!fetched.ok || fetched.payment.id !== row.provider_payment_id) return { status: "failed" };
    const p = fetched.payment;

    const { data: applied, error: applyError } = await d.admin.rpc("pix_charge_apply_backend", {
      p_provider_payment_id: row.provider_payment_id,
      p_status: p.status,
      p_amount: p.amount,
      p_external_reference: p.externalReference,
      p_currency: p.currency,
      p_collector_id: p.collectorId,
    });
    if (applyError) return { status: "failed" };
    return { status: (applied as PixStatus) ?? "pending" };
  } catch {
    return { status: "failed" };
  }
}
