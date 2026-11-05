"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import { CopyLinkButton } from "@/components/onboarding/CopyLinkButton";
import { createInviteAction } from "@/lib/actions/invites";
import { initialInviteState } from "@/lib/form-state";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" loading={pending} disabled={pending}>
      {pending ? "Enviando..." : "Gerar convite"}
    </Button>
  );
}

/**
 * Formulário "Convidar membro" (JON-27). Quando o envio de e-mail está configurado no servidor, o
 * convite também segue por e-mail; em qualquer caso a tela mostra o link para o dono copiar e compartilhar à mão
 * (WhatsApp, etc.), e diz com clareza se o e-mail saiu ou não.
 */
export function InviteFormFields({ onDone }: { onDone: () => void }) {
  const [state, formAction] = useActionState(createInviteAction, initialInviteState);

  if (state.status === "success" && state.inviteUrl) {
    return (
      <div className="space-y-4">
        <p className="text-body-md text-text-muted">
          {state.emailStatus === "sent"
            ? "Convite criado e enviado por e-mail. Se a pessoa não receber, copie o link abaixo e envie por outro canal. Ele expira em 7 dias."
            : state.emailStatus === "failed"
              ? "Convite criado, mas o e-mail não pôde ser enviado agora. Copie o link abaixo e envie para a pessoa (WhatsApp, etc.). Ele expira em 7 dias."
              : "Convite criado! Copie o link abaixo e envie para a pessoa (WhatsApp, e-mail, etc.). Ele expira em 7 dias."}
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-subdued px-3 py-2.5">
          <p className="min-w-0 flex-1 truncate text-body-md font-medium text-graphite">{state.inviteUrl}</p>
        </div>
        <div className="flex justify-end gap-2">
          <CopyLinkButton url={state.inviteUrl} />
          <Button onClick={onDone}>Concluir</Button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-label-lg text-graphite">E-mail do convidado *</span>
        <input
          name="email"
          type="email"
          required
          placeholder="funcionario@email.com"
          className="h-11 w-full rounded-xl border border-border bg-surface-card px-3 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
        />
        <p className="mt-1.5 text-body-sm text-text-muted">
          A pessoa vai entrar como membro da equipe (papel Staff). Convites para dono/proprietário não são feitos por
          aqui.
        </p>
      </label>

      {state.status === "error" && <ErrorState message={state.message ?? "Não foi possível criar o convite."} />}

      <SubmitButton />
    </form>
  );
}
