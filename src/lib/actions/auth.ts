"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AuthActionState } from "@/lib/form-state";

function friendlyAuthError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("already registered") || normalized.includes("already exists")) {
    return "Este e-mail já está cadastrado. Tente entrar em vez de criar uma nova conta.";
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
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!name) return { status: "error", message: "Informe seu nome." };
  if (!email) return { status: "error", message: "Informe um e-mail válido." };
  if (password.length < 6) {
    return { status: "error", message: "A senha deve ter pelo menos 6 caracteres." };
  }
  if (password !== confirmPassword) {
    return { status: "error", message: "As senhas não coincidem." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } },
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
