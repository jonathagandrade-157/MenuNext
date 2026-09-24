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
 * Formulário "Convidar membro" (JON-27). Resend ainda sem domínio
 * verificado, então nenhum e-mail é enviado de verdade — ao criar o
 * convite, a própria tela mostra o link para o dono copiar e compartilhar
 * manualmente (WhatsApp, etc.). Plugamos o envio via Resend depois, sem
 * mudar esse formulário.
 */
export function InviteFormFields({ onDone }: { onDone: () => void }) {
  const [state, formAction] = useActionState(createInviteAction, initialInviteState);

  if (state.status === "success" && state.inviteUrl) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-text-muted">
          Convite criado! Copie o link abaixo e envie para a pessoa (WhatsApp, e-mail, etc.). Ele expira em 7 dias.
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-subdued px-3 py-2.5">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-graphite">{state.inviteUrl}</p>
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
        <span className="mb-1.5 block text-sm font-semibold text-graphite">E-mail do convidado *</span>
        <input
          name="email"
          type="email"
          required
          placeholder="funcionario@email.com"
          className="h-11 w-full rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
        />
        <p className="mt-1.5 text-xs text-text-muted">
          A pessoa vai entrar como membro da equipe (papel Staff). Convites para dono/proprietário não são feitos por
          aqui.
        </p>
      </label>

      {state.status === "error" && <ErrorState message={state.message ?? "Não foi possível criar o convite."} />}

      <SubmitButton />
    </form>
  );
}
