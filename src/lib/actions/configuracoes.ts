"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyRestaurant } from "@/lib/tenant";
import type { ContactInfoActionState } from "@/lib/form-state";

const CONFIGURACOES_PATH = "/painel/configuracoes";
const BIO_MAX_LENGTH = 160;

/**
 * Pausa/reabre a loja (Configurações Gerais, JON-24) — único campo tocado é
 * restaurants.status, alternando só entre "active" e "paused" (os dois
 * únicos estados operacionais reversíveis pelo próprio lojista; "closed" e
 * "draft" não são expostos por este toggle). Zero migração: a coluna e a
 * policy restaurants_update_members (is_restaurant_member) já existem desde
 * a Sprint 1 — a storefront (computeStoreOpenState, src/lib/store.ts) já
 * trata "paused" como um estado publicamente visível, só bloqueando novos
 * pedidos (nunca some o cardápio, nunca vira "closed_permanently").
 *
 * Convenção de retorno igual a toggleProductAvailableAction
 * (src/lib/actions/products.ts): ação simples chamada direto do client via
 * onClick, não via useActionState/form — não precisa do formato
 * {status,message} de form-state.ts.
 */
export async function toggleRestaurantStatusAction(nextStatus: "active" | "paused"): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  if (restaurant.status !== "active" && restaurant.status !== "paused") {
    return { ok: false, error: "Esta loja ainda não pode ser pausada ou reaberta." };
  }

  const { error } = await supabase.from("restaurants").update({ status: nextStatus }).eq("id", restaurant.id);
  if (error) return { ok: false, error: "Não foi possível atualizar o status da loja. Tente novamente." };

  revalidatePath(CONFIGURACOES_PATH);
  revalidatePath("/painel");
  return { ok: true };
}

/**
 * Contato (WhatsApp/e-mail) e bio curta — únicos campos genuinamente
 * ausentes desta tela (nome e endereço já são editáveis em
 * /painel/informacoes, não duplicados aqui). bio e contact_whatsapp são
 * públicos (get_public_restaurant_by_slug, StoreHeader/botão flutuante de
 * WhatsApp na loja); contact_email fica só para uso interno.
 */
export async function saveContactInfoAction(
  _prev: ContactInfoActionState,
  formData: FormData
): Promise<ContactInfoActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const contactWhatsapp = String(formData.get("contact_whatsapp") ?? "").replace(/\D/g, "");
  const contactEmail = String(formData.get("contact_email") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim();

  if (bio.length > BIO_MAX_LENGTH) {
    return { status: "error", message: `A bio deve ter até ${BIO_MAX_LENGTH} caracteres.` };
  }
  if (contactEmail && !contactEmail.includes("@")) {
    return { status: "error", message: "Informe um e-mail válido." };
  }

  const { error } = await supabase
    .from("restaurants")
    .update({
      contact_whatsapp: contactWhatsapp || null,
      contact_email: contactEmail || null,
      bio: bio || null,
    })
    .eq("id", restaurant.id);
  if (error) return { status: "error", message: "Não foi possível salvar. Tente novamente." };

  revalidatePath(CONFIGURACOES_PATH);
  return { status: "success" };
}
