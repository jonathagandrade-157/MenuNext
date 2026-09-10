"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isValidDocument, normalizeDocument } from "@/lib/document";
import type { AuthActionState } from "@/lib/form-state";

function friendlyAuthError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("already registered") || normalized.includes("already exists")) {
    return "Este e-mail já está cadastrado. Tente entrar em vez de criar uma nova conta.";
  }
  // A violação do índice único de documento acontece dentro do trigger que
  // cria o profile, disparado durante o próprio signUp() — é o desempate
  // final para corrida entre dois cadastros simultâneos com o mesmo
  // CPF/CNPJ (a pré-checagem via is_document_eligible reduz a chance, mas
  // não fecha a corrida sozinha).
  if (normalized.includes("profiles_document_unique") || normalized.includes("duplicate key")) {
    return "Este CPF/CNPJ já utilizou o período de teste grátis do MenuNext.";
  }
  // O trigger recusa qualquer cadastro sem CPF/CNPJ válido (ou sem
  // documento nenhum) — inclusive uma chamada direta à API de auth que
  // não passe pelo formulário. Na UI normal isso nunca deveria acontecer,
  // porque o document já é validado antes de chamar signUp().
  if (normalized.includes("document_required")) {
    return "É obrigatório informar um CPF ou CNPJ válido para criar sua conta.";
  }
  if (normalized.includes("password should be at least") || normalized.includes("password")) {
    return "A senha deve ter pelo menos 6 caracteres.";
  }
  if (normalized.includes("invalid login credentials")) {
    return "E-mail ou senha incorretos.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.";
  }
  if (normalized.includes("rate limit")) {
    return "Muitas tentativas seguidas. Aguarde um instante e tente novamente.";
  }
  return "Não foi possível concluir a operação. Tente novamente em instantes.";
}

export async function signUpAction(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const storeName = String(formData.get("storeName") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const document = normalizeDocument(String(formData.get("document") ?? ""));
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const termsAccepted = formData.get("terms") === "on";

  if (!storeName) return { status: "error", message: "Informe o nome da sua loja." };
  if (!name) return { status: "error", message: "Informe seu nome." };
  if (!email) return { status: "error", message: "Informe um e-mail válido." };
  if (!phone) return { status: "error", message: "Informe um telefone para contato." };
  if (!isValidDocument(document)) {
    return { status: "error", message: "Informe um CPF ou CNPJ válido." };
  }
  if (password.length < 6) {
    return { status: "error", message: "A senha deve ter pelo menos 6 caracteres." };
  }
  if (password !== confirmPassword) {
    return { status: "error", message: "As senhas não coincidem." };
  }
  if (!termsAccepted) {
    return { status: "error", message: "Você precisa aceitar os Termos de Uso para continuar." };
  }

  const supabase = await createClient();

  // Pré-checagem de elegibilidade (UX): dá um erro claro antes de tentar
  // criar a conta. Não é a garantia de concorrência — essa é o UNIQUE
  // constraint em profiles.document, verificado de novo dentro do trigger
  // que roda durante o signUp() logo abaixo.
  const { data: eligible, error: eligibilityError } = await supabase.rpc("is_document_eligible", {
    p_document: document,
  });
  if (!eligibilityError && eligible === false) {
    return {
      status: "error",
      message: "Este CPF/CNPJ já utilizou o período de teste grátis do MenuNext.",
    };
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, phone, document, store_name: storeName } },
  });

  if (error) {
    return { status: "error", message: friendlyAuthError(error.message) };
  }

  // Confirmação de e-mail está desativada no projeto Supabase, então signUp()
  // já retorna uma sessão ativa. O restaurante é criado no Passo 1 do
  // onboarding (usuário já autenticado), não aqui.
  if (!data.session) {
    return {
      status: "error",
      message: "Não foi possível concluir o cadastro. Tente novamente.",
    };
  }

  redirect("/onboarding/passo-1?welcome=1");
}

export async function signInAction(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { status: "error", message: "Informe e-mail e senha." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { status: "error", message: friendlyAuthError(error.message) };
  }

  redirect("/painel");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
