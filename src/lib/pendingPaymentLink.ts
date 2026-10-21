/**
 * Reabre o link de pagamento da assinatura PENDENTE do lojista (Mercado Pago):
 * quem fecha a aba do checkout antes de pagar precisa do link de novo. Sem
 * Next.js e sem acesso direto a rede: a chamada à API entra por `deps`.
 *
 * O link NUNCA vem do navegador nem do banco: é lido agora pela API autenticada
 * do Mercado Pago, depois de conferir que a assinatura é a registrada (id,
 * referência do MenuNext e valor do plano) e de o endereço ser HTTPS de domínio
 * do Mercado Pago.
 */
import type { MercadoPagoPreapproval, MercadoPagoResult } from "./mercadopago";
import { isMercadoPagoCheckoutUrl, verifyMercadoPagoPreapproval } from "./mercadopagoVerify";

export type PendingSubscriptionRow = {
  out_subscription_id: string;
  out_provider: string;
  out_subscription_ref: string;
  out_amount: number | string;
};

export type PendingPaymentLinkResult =
  | { status: "link"; url: string }
  | { status: "info"; message: string }
  | { status: "error"; message: string };

const ERROR = "Não foi possível abrir o pagamento agora. Tente novamente em instantes.";

export async function resolvePendingPaymentLink(
  row: PendingSubscriptionRow | null | undefined,
  deps: { getPreapproval(id: string): Promise<MercadoPagoResult<MercadoPagoPreapproval>> }
): Promise<PendingPaymentLinkResult> {
  if (!row?.out_subscription_id) return { status: "error", message: "Não há pagamento pendente." };
  if (row.out_provider !== "mercadopago") {
    return { status: "info", message: "O link de pagamento foi enviado ao seu e-mail pelo provedor de cobrança." };
  }

  const remote = await deps.getPreapproval(row.out_subscription_ref);
  if (!remote.ok) return { status: "error", message: ERROR };

  const verdict = verifyMercadoPagoPreapproval(remote.data, {
    preapprovalId: row.out_subscription_ref,
    amount: Number(row.out_amount),
    externalReference: row.out_subscription_id,
  });
  if (!verdict.ok) return { status: "error", message: ERROR };

  if (remote.data.status === "authorized") {
    return {
      status: "info",
      message: "Pagamento autorizado. Assim que a primeira cobrança for confirmada, o acesso é liberado.",
    };
  }
  if (!isMercadoPagoCheckoutUrl(remote.data.init_point)) return { status: "error", message: ERROR };
  return { status: "link", url: remote.data.init_point };
}
