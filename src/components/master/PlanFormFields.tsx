"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import { initialPlanState, type PlanActionState } from "@/lib/form-state";
import type { Plan } from "@/lib/tenant";

const inputClass =
  "h-11 w-full rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

const fieldLabelClass = "mb-1.5 block text-sm font-semibold text-graphite";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" loading={pending} disabled={pending}>
      {pending ? "Salvando..." : label}
    </Button>
  );
}

/** Formulário de Novo/Editar plano — nome e preço são dados reais de
 * negócio, cadastrados aqui pelo MASTER; nunca um valor sugerido/inventado
 * pelo código. */
export function PlanFormFields({
  action,
  plan,
  submitLabel,
  onSuccess,
}: {
  action: (prev: PlanActionState, formData: FormData) => Promise<PlanActionState>;
  plan?: Plan;
  submitLabel: string;
  onSuccess: () => void;
}) {
  const [state, formAction] = useActionState(action, initialPlanState);

  useEffect(() => {
    if (state.status === "success") onSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  return (
    <form action={formAction} className="space-y-4">
      {plan && <input type="hidden" name="planId" value={plan.id} />}

      <label className="block">
        <span className={fieldLabelClass}>Nome do plano *</span>
        <input name="name" type="text" required maxLength={60} defaultValue={plan?.name ?? ""} placeholder="Ex.: Pro" className={inputClass} />
      </label>

      <label className="block">
        <span className={fieldLabelClass}>Preço mensal (R$) *</span>
        <input
          name="price"
          type="text"
          inputMode="decimal"
          required
          defaultValue={plan?.price ?? ""}
          placeholder="99,00"
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className={fieldLabelClass}>Descrição (opcional)</span>
        <textarea
          name="description"
          rows={3}
          maxLength={500}
          defaultValue={plan?.description ?? ""}
          placeholder="O que inclui este plano"
          className="w-full rounded-lg border border-border bg-surface-card px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
        />
      </label>

      {state.status === "error" && <ErrorState message={state.message ?? "Não foi possível salvar."} />}

      <SubmitButton label={submitLabel} />
    </form>
  );
}
