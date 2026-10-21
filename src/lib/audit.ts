/**
 * Registro de auditoria (tabela audit_log) — leitura só por funções protegidas do banco:
 * restaurant_audit_recent (o OWNER lê a própria loja) e master_audit_list (só master).
 * Falha ao ler nunca derruba a tela: vira lista vazia, porque a auditoria é um apoio, não o fluxo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const AUDIT_PAGE_SIZE = 50;

export type AuditEntry = {
  created_at: string;
  actor_name: string;
  actor_role: string | null;
  action: "insert" | "update" | "delete";
  entity: string;
  summary: string;
};

export type MasterAuditEntry = AuditEntry & {
  restaurant_id: string | null;
  restaurant_name: string | null;
};

const ROLE_LABEL: Record<string, string> = { OWNER: "Proprietário", STAFF: "Equipe", MASTER: "Master" };

export function auditRoleLabel(role: string | null): string {
  return role ? (ROLE_LABEL[role] ?? role) : "Sistema";
}

/** Página da URL (?pagina=N): inteiro ≥ 1; qualquer outra coisa vira 1. */
export function parseAuditPage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

export async function getRestaurantAudit(supabase: SupabaseClient, limit = 20): Promise<AuditEntry[]> {
  const { data, error } = await supabase.rpc("restaurant_audit_recent", { p_limit: limit });
  if (error || !data) return [];
  return data as AuditEntry[];
}

export async function getMasterAudit(
  supabase: SupabaseClient,
  options: { limit?: number; page?: number; restaurantId?: string | null } = {}
): Promise<{ rows: MasterAuditEntry[]; total: number }> {
  const limit = options.limit ?? AUDIT_PAGE_SIZE;
  const page = options.page ?? 1;
  const { data, error } = await supabase.rpc("master_audit_list", {
    p_limit: limit,
    p_offset: (page - 1) * limit,
    p_restaurant: options.restaurantId ?? null,
  });
  if (error || !data) return { rows: [], total: 0 };

  const raw = data as (MasterAuditEntry & { total: number | string })[];
  const rows: MasterAuditEntry[] = raw.map((r) => ({
    created_at: r.created_at,
    restaurant_id: r.restaurant_id,
    restaurant_name: r.restaurant_name,
    actor_name: r.actor_name,
    actor_role: r.actor_role,
    action: r.action,
    entity: r.entity,
    summary: r.summary,
  }));
  return { rows, total: raw.length > 0 ? Number(raw[0].total) : 0 };
}
