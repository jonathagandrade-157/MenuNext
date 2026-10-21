/**
 * Cliente Supabase com a chave de SERVIDOR (service_role). Existe só para as
 * operações de cobrança que o banco recusa ao navegador: registrar os ids do
 * provedor depois de provados na API do Asaas e reconciliar pagamentos.
 *
 * Regras:
 * - A chave (`SUPABASE_SERVICE_ROLE_KEY`) nunca tem prefixo NEXT_PUBLIC_ e este
 *   módulo só pode ser importado por Server Actions, Route Handlers e libs de
 *   servidor. Nunca importe em componente de cliente.
 * - Ignora RLS: use somente as RPCs de cobrança, nunca `from(...)` livre.
 * - Sem a chave, as operações falham FECHADO (nenhuma assinatura é registrada).
 */
import { createClient } from "@supabase/supabase-js";

export function isAdminConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("createAdminClient não pode rodar no navegador");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("admin_not_configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
