"use server";

import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Status do Pix automático de um pedido, para o detalhe do pedido no painel. Só leitura: a RLS de
 * order_pix_charges entrega a linha apenas a membros da loja do pedido (OWNER ou STAFF). Sem a migration, sem
 * login ou de outra loja: null.
 */
export async function getOrderPixStatusAction(orderId: string): Promise<{ status: string } | null> {
  if (typeof orderId !== "string" || !UUID.test(orderId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("order_pix_charges").select("status").eq("order_id", orderId).maybeSingle();
  if (error || !data) return null;
  return { status: String((data as { status: unknown }).status) };
}
