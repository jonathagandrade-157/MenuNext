"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { updateBillingSettingsAction } from "@/lib/actions/plans";
import { initialPlanState } from "@/lib/form-state";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={pending}>
      {pending ? "Salvando..." : "Salvar token"}
    </Button>
  );
}

/** Token de webhook do Asaas — o mesmo valor configurado em "Token de
 * acesso" na configuração de webhook do painel Asaas. A RPC
 * process_asaas_webhook compara este valor com o header enviado pelo
 * Asaas em cada evento; sem isso configurado, nenhum webhook é aceito
 * (fail-closed, não fail-open). */
export function BillingSettingsForm() {
  const [state, formAction] = useActionState(updateBillingSettingsAction, initialPlanState);

  return (
    <Card className="p-5">
      <h2 className="text-sm font-bold text-graphite">Integração Asaas</h2>
      <p className="mt-0.5 text-xs text-text-muted">
        Token de acesso do webhook (configurado também no painel do Asaas, em Integrações → Webhooks). A chave de API
        (ASAAS_API_KEY) é configurada como variável de ambiente do servidor, nunca aqui.
      </p>

      <form action={formAction} className="mt-4 space-y-3">
        <input
          name="asaasWebhookToken"
          type="text"
          placeholder="Token de acesso do webhook"
          className="h-11 w-full rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
        />

        {state.status === "error" && <p className="text-xs font-semibold text-red">{state.message}</p>}
        {state.status === "success" && <p className="text-xs font-semibold text-emerald">Salvo com sucesso!</p>}

        <SubmitButton />
      </form>
    </Card>
  );
}
