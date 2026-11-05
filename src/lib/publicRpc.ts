import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

/**
 * Chamada das funções do banco que o checkout público e o cadastro usam e que NÃO são mais executáveis pela
 * chave pública do Supabase (migration 20261027020000): só o servidor do app (service_role) as chama, depois de
 * aplicar os limites de tentativas. Assim o limite não tem como ser contornado chamando a API direto.
 *
 * Só importe daqui em Server Actions e rotas de servidor. Falha FECHADO: sem a chave de servidor, nada é feito.
 */
export type PublicRpcName = "create_order" | "validate_coupon" | "preview_promotion" | "is_document_eligible";

export type PublicRpcResult<T> = { data: T | null; error: { message: string } | null };

export const CHECKOUT_UNAVAILABLE = "checkout_unavailable";

export async function callPublicRpc<T>(fn: PublicRpcName, args: Record<string, unknown>): Promise<PublicRpcResult<T>> {
  if (!isAdminConfigured()) return { data: null, error: { message: CHECKOUT_UNAVAILABLE } };
  try {
    const { data, error } = await createAdminClient().rpc(fn, args);
    return { data: (data as T | null) ?? null, error: error ? { message: error.message } : null };
  } catch {
    return { data: null, error: { message: CHECKOUT_UNAVAILABLE } };
  }
}
