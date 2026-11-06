import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pickClientIp } from "@/lib/clientIp";
import { evaluateMasterNetwork, MASTER_MFA_PATH, masterMfaRequired } from "@/lib/masterAccess";

/**
 * Defesa em profundidade do isolamento do Master (o proxy já nega na borda; isto repete a decisão dentro de cada
 * página e Server Action, que são endpoints próprios). Rede negada = 404 (o Master não "existe" para quem não deve).
 */
export async function assertMasterNetwork(): Promise<void> {
  const h = await headers();
  const decision = evaluateMasterNetwork({
    host: h.get("x-forwarded-host") ?? h.get("host"),
    ip: pickClientIp(h.get("x-forwarded-for"), h.get("x-real-ip")),
  });
  if (!decision.allowed) notFound();
}

/** Nível AAL2 (segundo fator verificado) quando MASTER_REQUIRE_MFA=true. Qualquer dúvida ou erro: manda para o desafio. */
export async function assertMasterMfa(supabase: SupabaseClient): Promise<void> {
  if (!masterMfaRequired()) return;
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || data?.currentLevel !== "aal2") redirect(MASTER_MFA_PATH);
}
