import type { Metadata } from "next";
import { AuthShell } from "@/components/cadastro/AuthShell";
import { RecuperarSenhaForm } from "@/components/cadastro/RecuperarSenhaForm";

export const metadata: Metadata = { title: "Recuperar senha — MenuNext" };

export default async function RecuperarSenhaPage(props: PageProps<"/recuperar-senha">) {
  const searchParams = await props.searchParams;
  return (
    <AuthShell>
      <RecuperarSenhaForm linkExpired={searchParams.erro === "link"} />
    </AuthShell>
  );
}
