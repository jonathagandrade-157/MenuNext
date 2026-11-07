"use server";

import { checkIpRateLimit } from "@/lib/rateLimit";
import { createClient } from "@/lib/supabase/server";
import { PIX_SYNC_MIN_INTERVAL_SECONDS } from "@/lib/pixAuto";
import { syncPixCharge } from "@/lib/pixAutoService";
import { readOrderPixCharge, type PublicPixCharge } from "@/lib/pixCharge";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Página do pedido pergunta "já pagou?". Público (o cliente não tem login): o public_id não adivinhável é a
 * autorização, como em get_public_order. Limitado por IP; a consulta ao Mercado Pago tem intervalo mínimo por
 * cobrança no banco. Devolve só status/valor — o copia-e-cola só enquanto pendente.
 */
export async function refreshOrderPixAction(slug: string, publicId: string): Promise<PublicPixCharge | null> {
  if (typeof slug !== "string" || slug.length === 0 || slug.length > 80 || typeof publicId !== "string" || !UUID.test(publicId)) {
    return null;
  }
  const limit = await checkIpRateLimit("pix-status:ip", { limit: 40, windowSeconds: 300 });
  if (limit.allowed) await syncPixCharge({ slug, publicId }, PIX_SYNC_MIN_INTERVAL_SECONDS);
  const supabase = await createClient();
  return readOrderPixCharge(supabase, slug, publicId);
}
