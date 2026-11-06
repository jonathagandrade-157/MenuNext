import { redirect } from "next/navigation";
import { getAuthedUser, isPlatformAdmin, resolvePostAuthPath } from "@/lib/tenant";
import { assertMasterNetwork } from "@/lib/masterGuard";
import { masterMfaRequired } from "@/lib/masterAccess";
import { MasterMfaClient } from "@/components/master/MasterMfaClient";

// Segundo fator do Master. Fica FORA de /master (cujo layout exige o segundo fator) para não entrar em laço.
// Só administradores da plataforma chegam aqui; qualquer outra pessoa é mandada para o destino normal.
export default async function MasterMfaPage() {
  await assertMasterNetwork();
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro?mode=login&next=%2Fmaster");
  if (!(await isPlatformAdmin(supabase))) redirect(await resolvePostAuthPath(supabase));
  if (!masterMfaRequired()) redirect("/master");
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (data?.currentLevel === "aal2") redirect("/master");
  return <MasterMfaClient />;
}
