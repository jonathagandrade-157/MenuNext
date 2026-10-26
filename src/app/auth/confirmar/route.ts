import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PASSWORD_RESET_COOKIE, PASSWORD_RESET_COOKIE_MAX_AGE_SECONDS } from "@/lib/passwordReset";

/**
 * Destino do link do e-mail de redefinição de senha. Troca o código de uso único por uma sessão e marca o
 * navegador (cookie de 15 minutos) para que /redefinir-senha aceite a troca. O destino é fixo: nada vindo da
 * URL decide para onde a pessoa vai (sem open redirect).
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) redirect("/recuperar-senha?erro=link");

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  // Costuma falhar quando o link é aberto em outro navegador/aparelho do que pediu (o código de verificação fica no
  // navegador de origem), ou quando já foi usado/expirou.
  if (error) redirect("/recuperar-senha?erro=link");

  (await cookies()).set(PASSWORD_RESET_COOKIE, "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PASSWORD_RESET_COOKIE_MAX_AGE_SECONDS,
  });
  redirect("/redefinir-senha");
}
