"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwnerPage } from "@/lib/tenant";

const CLIENTES_PATH = "/painel/clientes";
const NOTE_MAX_LENGTH = 500;

/**
 * Notas internas de cliente (área "Clientes" do redesign) — insert-only,
 * mesma regra de acesso da página (requireOwnerPage: só OWNER, RLS
 * customer_notes_insert_owner reforça o mesmo limite no servidor).
 */
export async function addCustomerNoteAction(
  customerPhone: string,
  note: string
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, restaurant } = await requireOwnerPage();

  const normalizedPhone = customerPhone.replace(/\D/g, "");
  const trimmedNote = note.trim();

  if (!trimmedNote) return { ok: false, error: "Escreva algo antes de salvar." };
  if (trimmedNote.length > NOTE_MAX_LENGTH) {
    return { ok: false, error: `A nota deve ter até ${NOTE_MAX_LENGTH} caracteres.` };
  }
  if (normalizedPhone.length < 10 || normalizedPhone.length > 11) {
    return { ok: false, error: "Cliente inválido." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/cadastro");

  const { error } = await supabase.from("customer_notes").insert({
    restaurant_id: restaurant.id,
    customer_phone: normalizedPhone,
    note: trimmedNote,
    created_by: user.id,
  });

  if (error) return { ok: false, error: "Não foi possível salvar a nota. Tente novamente." };

  revalidatePath(CLIENTES_PATH);
  return { ok: true };
}
