import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/cadastro/AuthShell";
import { RedefinirSenhaForm } from "@/components/cadastro/RedefinirSenhaForm";
import { PASSWORD_RESET_COOKIE } from "@/lib/passwordReset";
import { getAuthedUser } from "@/lib/tenant";

export const metadata: Metadata = { title: "Nova senha — MenuNext", robots: { index: false } };

/** Só abre com a sessão e o cookie que /auth/confirmar cria ao validar o link do e-mail; sem eles, volta a pedir o link. */
export default async function RedefinirSenhaPage() {
  const { user } = await getAuthedUser();
  const hasMark = Boolean((await cookies()).get(PASSWORD_RESET_COOKIE));
  if (!user || !hasMark) redirect("/recuperar-senha?erro=link");

  return (
    <AuthShell>
      <RedefinirSenhaForm />
    </AuthShell>
  );
}
