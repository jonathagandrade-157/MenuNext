"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ErrorMessage, Field, SubmitButton } from "@/components/cadastro/CadastroForm";
import { requestPasswordResetAction } from "@/lib/actions/passwordReset";
import { initialPasswordResetState } from "@/lib/form-state";

export function RecuperarSenhaForm({ linkExpired }: { linkExpired: boolean }) {
  const [state, formAction] = useActionState(requestPasswordResetAction, initialPasswordResetState);

  if (state.status === "success") {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-headline-lg font-extrabold text-graphite">Confira seu e-mail</h1>
        <p className="text-body-md text-text-muted" role="status">
          {state.message}
        </p>
        <p className="text-body-sm text-text-muted">
          Não chegou? Veja a caixa de spam. Abra o link no mesmo aparelho e navegador em que pediu.
        </p>
        <Link href="/cadastro?mode=login" className="inline-block text-body-md font-semibold text-primary hover:underline">
          Voltar para o login
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-headline-lg font-extrabold text-graphite">Esqueceu a senha?</h1>
        <p className="mt-1 text-body-md text-text-muted">
          Informe o e-mail da sua conta e enviaremos um link para criar uma nova senha.
        </p>
      </div>

      {linkExpired && (
        <ErrorMessage message="Esse link não é mais válido (expirou, já foi usado ou foi aberto em outro navegador). Peça um novo abaixo." />
      )}

      <form action={formAction} className="space-y-4">
        <Field label="E-mail" name="email" type="email" autoComplete="email" required />
        {state.status === "error" && <ErrorMessage message={state.message} />}
        <SubmitButton label="Enviar link de redefinição" />
      </form>

      <p className="text-center text-body-md text-text-muted">
        Lembrou?{" "}
        <Link href="/cadastro?mode=login" className="font-semibold text-primary hover:underline">
          Voltar para o login
        </Link>
      </p>
    </div>
  );
}
