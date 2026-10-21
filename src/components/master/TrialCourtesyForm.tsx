"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import { extendTrialAction } from "@/lib/actions/master";
import { initialTrialExtensionState } from "@/lib/form-state";
import { TRIAL_EXTENSION_OPTIONS } from "@/lib/trialExtension";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={pending}>
      {pending ? "Prorrogando..." : "Prorrogar teste"}
    </Button>
  );
}

/** Cortesia de trial (só master): soma dias ao teste gratuito do responsável. */
export function TrialCourtesyForm({ restaurantId }: { restaurantId: string }) {
  const [state, formAction] = useActionState(extendTrialAction, initialTrialExtensionState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="restaurantId" value={restaurantId} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1.5 block text-label-lg text-graphite">Adicionar</span>
          <select
            name="days"
            defaultValue="30"
            className="h-11 rounded-xl border border-border bg-surface-card px-3 text-body-md text-graphite focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
          >
            {TRIAL_EXTENSION_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days} dias
              </option>
            ))}
          </select>
        </label>
        <SubmitButton />
      </div>
      {state.status === "error" && <ErrorState message={state.message ?? "Não foi possível prorrogar o teste."} />}
      {state.status === "success" && <p className="text-label-lg text-emerald">Teste prorrogado!</p>}
    </form>
  );
}
