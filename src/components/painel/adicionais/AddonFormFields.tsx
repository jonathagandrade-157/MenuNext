"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import { initialAddonState, type AddonActionState } from "@/lib/form-state";
import type { Addon } from "@/lib/tenant";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" loading={pending} disabled={pending}>
      {pending ? "Salvando..." : label}
    </Button>
  );
}

const inputClass =
  "h-11 w-full rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

/** Formulário de Novo/Editar adicional (item de um grupo) — mesmo corpo para os dois casos. */
export function AddonFormFields({
  action,
  addonGroupId,
  addon,
  submitLabel,
  onSuccess,
}: {
  action: (prev: AddonActionState, formData: FormData) => Promise<AddonActionState>;
  addonGroupId: string;
  addon?: Addon;
  submitLabel: string;
  onSuccess: () => void;
}) {
  const [state, formAction] = useActionState(action, initialAddonState);

  useEffect(() => {
    if (state.status === "success") onSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="addonGroupId" value={addonGroupId} />
      {addon && <input type="hidden" name="addonId" value={addon.id} />}

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-graphite">Nome *</span>
        <input
          name="name"
          type="text"
          required
          maxLength={80}
          defaultValue={addon?.name}
          placeholder="Ex.: Catupiry"
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-graphite">Descrição</span>
        <textarea
          name="description"
          maxLength={200}
          rows={2}
          defaultValue={addon?.description ?? ""}
          placeholder="Ex.: Recheio cremoso de catupiry"
          className="w-full rounded-lg border border-border bg-surface-card px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-graphite">Preço adicional *</span>
        <input
          name="price"
          type="text"
          inputMode="decimal"
          required
          defaultValue={addon ? addon.price.toFixed(2).replace(".", ",") : "0,00"}
          className={inputClass}
        />
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="isAvailable"
          defaultChecked={addon?.is_available ?? true}
          className="h-4 w-4 rounded border-border"
        />
        <span className="text-sm font-semibold text-graphite">Disponível</span>
      </label>

      {state.status === "error" && <ErrorState message={state.message ?? "Não foi possível salvar."} />}

      <SubmitButton label={submitLabel} />
    </form>
  );
}
