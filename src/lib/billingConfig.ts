import { isAsaasConfigured } from "./asaas";
import { isMercadoPagoConfigured } from "./mercadopago";
import { isAdminConfigured } from "./supabase/admin";

/** A cobrança de assinaturas só funciona com a chave do Asaas E a chave de
 * servidor do Supabase (usada para registrar a assinatura já provada). Sem uma
 * das duas, nada é criado no Asaas: falha antes, sem cobrança órfã. */
export function isBillingConfigured(): boolean {
  return isAsaasConfigured() && isAdminConfigured();
}

/** Mesma regra para o Mercado Pago: token da API E chave de servidor do Supabase. O segredo do
 * webhook é exigido só pela rota do webhook (sem ele, nenhum evento é aceito). */
export function isMercadoPagoBillingConfigured(): boolean {
  return isMercadoPagoConfigured() && isAdminConfigured();
}

export type SubscriptionProvider = "asaas" | "mercadopago";

export function isBillingConfiguredFor(provider: SubscriptionProvider): boolean {
  return provider === "mercadopago" ? isMercadoPagoBillingConfigured() : isBillingConfigured();
}
