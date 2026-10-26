"use client";

import { useActionState } from "react";
import { ErrorMessage, Field, SubmitButton } from "@/components/cadastro/CadastroForm";
import { updatePasswordAction } from "@/lib/actions/passwordReset";
import { initialPasswordResetState } from "@/lib/form-state";
import { PASSWORD_MIN_LENGTH } from "@/lib/password";

export function RedefinirSenhaForm() {
  const [state, formAction] = useActionState(updatePasswordAction, initialPasswordResetState);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-headline-lg font-extrabold text-graphite">Crie uma nova senha</h1>
        <p className="mt-1 text-body-md text-text-muted">
          Depois de salvar, os outros aparelhos conectados à sua conta serão desconectados.
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        <Field label="Nova senha" name="password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} />
        <p className="-mt-2 text-body-sm text-text-muted">Mínimo de {PASSWORD_MIN_LENGTH} caracteres, com letras e números.</p>
        <Field
          label="Confirmar nova senha"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
        />
        {state.status === "error" && <ErrorMessage message={state.message} />}
        <SubmitButton label="Salvar nova senha" />
      </form>
    </div>
  );
}
