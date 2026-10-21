"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { LEGAL_LAST_UPDATED } from "@/lib/legal";

/** Registra o aceite da versão atual dos Termos e da Política de Privacidade
 * (reaceite quando os textos mudam). Só grava o aceite de quem está logado. */
export async function acceptTermsAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/cadastro");

  if (formData.get("terms") !== "on") redirect("/painel");

  const { error } = await supabase.auth.updateUser({
    data: { terms_accepted_at: new Date().toISOString(), terms_version: LEGAL_LAST_UPDATED },
  });
  if (error) redirect("/painel");

  revalidatePath("/painel", "layout");
  redirect("/painel");
}
