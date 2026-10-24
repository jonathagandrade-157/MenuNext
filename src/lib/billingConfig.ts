import { isAsaasConfigured } from "./asaas";
import { isMercadoPagoConfigured, isMercadoPagoWebhookConfigured } from "./mercadopago";
import { isAdminConfigured } from "./supabase/admin";

/** A cobrança de assinaturas só funciona com a chave do Asaas E a chave de
 * servidor do Supabase (usada para registrar a assinatura já provada). Sem uma
 * das duas, nada é criado no Asaas: falha antes, sem cobrança órfã. */
export function isBillingConfigured(): boolean {
  return isAsaasConfigured() && isAdminConfigured();
}

/** Mesma regra para o Mercado Pago, e ainda o segredo do webhook: sem ele nenhum pagamento seria
 * reconhecido, então não se abre assinatura (falha ANTES de cobrar quem nunca vai ser liberado). */
export function isMercadoPagoBillingConfigured(): boolean {
  return isMercadoPagoConfigured() && isMercadoPagoWebhookConfigured() && isAdminConfigured();
}

export type SubscriptionProvider = "asaas" | "mercadopago";

export function isBillingConfiguredFor(provider: SubscriptionProvider): boolean {
  return provider === "mercadopago" ? isMercadoPagoBillingConfigured() : isBillingConfigured();
}
