"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import { updateComboAction } from "@/lib/actions/combos";
import { initialComboState } from "@/lib/form-state";
import type { Combo } from "@/lib/tenant";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" loading={pending} disabled={pending}>
      {pending ? "Salvando..." : "Salvar alterações"}
    </Button>
  );
}

const inputClass =
  "h-11 w-full rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

/** Campos base de um combo já existente (imagem e composição são geridas à parte). */
export function ComboFormFields({ combo, onSuccess }: { combo: Combo; onSuccess: () => void }) {
  const [state, formAction] = useActionState(updateComboAction, initialComboState);

  useEffect(() => {
    if (state.status === "success") onSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="comboId" value={combo.id} />

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-graphite">Nome *</span>
        <input name="name" type="text" required maxLength={80} defaultValue={combo.name} className={inputClass} />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-graphite">Descrição</span>
        <textarea
          name="description"
          maxLength={300}
          rows={2}
          defaultValue={combo.description ?? ""}
          className="w-full rounded-lg border border-border bg-surface-card px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-graphite">Preço do combo *</span>
        <input
          name="price"
          type="text"
          inputMode="decimal"
          required
          defaultValue={combo.price.toFixed(2).replace(".", ",")}
          className={inputClass}
        />
      </label>

      <label className="flex items-center gap-2">
        <input type="checkbox" name="isAvailable" defaultChecked={combo.is_available} className="h-4 w-4 rounded border-border" />
        <span className="text-sm font-semibold text-graphite">Disponível</span>
      </label>

      {state.status === "error" && <ErrorState message={state.message ?? "Não foi possível salvar."} />}

      <SubmitButton />
    </form>
  );
}
