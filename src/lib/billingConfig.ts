import { isAsaasConfigured } from "./asaas";
import { isAdminConfigured } from "./supabase/admin";

/** A cobrança de assinaturas só funciona com a chave do Asaas E a chave de
 * servidor do Supabase (usada para registrar a assinatura já provada). Sem uma
 * das duas, nada é criado no Asaas: falha antes, sem cobrança órfã. */
export function isBillingConfigured(): boolean {
  return isAsaasConfigured() && isAdminConfigured();
}
