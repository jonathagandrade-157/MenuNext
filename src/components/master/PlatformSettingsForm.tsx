"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/States";
import { updatePlatformSettingsAction } from "@/lib/actions/master";
import { initialPlatformSettingsState } from "@/lib/form-state";
import type { PlatformSettings } from "@/lib/tenant";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={pending}>
      {pending ? "Salvando..." : "Salvar"}
    </Button>
  );
}

/**
 * Contato de suporte da plataforma (JON-9/master) — usado em
 * /painel/ajuda. Enquanto os campos ficarem em branco, a tela de ajuda não
 * mostra nenhum contato (nunca um número/e-mail inventado).
 */
export function PlatformSettingsForm({ settings }: { settings: PlatformSettings }) {
  const [state, formAction] = useActionState(updatePlatformSettingsAction, initialPlatformSettingsState);

  return (
    <Card className="max-w-lg space-y-4 p-6">
      <div>
        <h2 className="text-body-lg font-bold uppercase tracking-wide text-text-muted">Contato de suporte</h2>
        <p className="mt-1 text-body-md text-text-muted">
          Exibido para os lojistas em Ajuda. Deixe em branco para não mostrar esse contato.
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-label-lg text-graphite">E-mail de suporte</span>
          <input
            name="supportEmail"
            type="email"
            defaultValue={settings.support_email ?? ""}
            placeholder="suporte@seudominio.com"
            className="h-11 w-full rounded-xl border border-border bg-surface-card px-3 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-label-lg text-graphite">WhatsApp de suporte</span>
          <input
            name="supportWhatsapp"
            type="tel"
            defaultValue={settings.support_whatsapp ?? ""}
            placeholder="11999999999"
            className="h-11 w-full rounded-xl border border-border bg-surface-card px-3 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
          />
          <p className="mt-1.5 text-body-sm text-text-muted">Só números, com DDD (sem espaços/traços).</p>
        </label>

        {state.status === "error" && <ErrorState message={state.message ?? "Não foi possível salvar."} />}

        <div className="flex items-center gap-3">
          <SubmitButton />
          {state.status === "success" && <span className="text-label-lg text-emerald">Salvo!</span>}
        </div>
      </form>
    </Card>
  );
}
