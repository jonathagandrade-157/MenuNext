"use client";

import { useActionState } from "react";
import { savePasso7Action } from "@/lib/actions/onboarding";
import { initialStepState } from "@/lib/form-state";
import { FieldLabel, inputClass, ErrorMessage } from "@/components/onboarding/OnboardingShell";
import { SubmitButton } from "@/components/onboarding/SubmitButton";

export function Passo7Form() {
  const [state, formAction] = useActionState(savePasso7Action, initialStepState);

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <FieldLabel>Nome do produto *</FieldLabel>
        <input name="name" type="text" required placeholder="Ex.: X-Bacon Artesanal" className={inputClass} />
      </div>

      <div>
        <FieldLabel>Descrição</FieldLabel>
        <textarea
          name="description"
          rows={3}
          placeholder="Pão brioche, blend 180g, cheddar duplo, bacon crocante."
          className="w-full rounded-lg border border-border bg-surface-card px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
        />
      </div>

      <div>
        <FieldLabel>Preço (R$) *</FieldLabel>
        <input name="price" type="text" inputMode="decimal" required placeholder="28,90" className={inputClass} />
      </div>

      <div>
        <FieldLabel>Foto (link opcional)</FieldLabel>
        <input name="image_url" type="url" placeholder="https://..." className={inputClass} />
        <p className="mt-1.5 text-xs text-text-muted">
          Você pode adicionar fotos enviadas diretamente do celular depois, no painel.
        </p>
      </div>

      <ErrorMessage message={state.status === "error" ? state.message : undefined} />

      <SubmitButton label="Publicar loja online" />
    </form>
  );
}
