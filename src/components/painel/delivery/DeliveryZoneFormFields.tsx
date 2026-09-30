"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import { initialDeliveryZoneState, type DeliveryZoneActionState } from "@/lib/form-state";
import type { DeliveryZone } from "@/lib/tenant";

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

/** Formulário de Nova/Editar zona de entrega — mesmo corpo para os dois casos
 * (mesmo padrão de CategoryFormFields). */
export function DeliveryZoneFormFields({
  action,
  zone,
  submitLabel,
  onSuccess,
}: {
  action: (prev: DeliveryZoneActionState, formData: FormData) => Promise<DeliveryZoneActionState>;
  zone?: DeliveryZone;
  submitLabel: string;
  onSuccess: () => void;
}) {
  const [state, formAction] = useActionState(action, initialDeliveryZoneState);

  useEffect(() => {
    if (state.status === "success") onSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  return (
    <form action={formAction} className="space-y-4">
      {zone && <input type="hidden" name="zoneId" value={zone.id} />}

      <label className="block">
        <span className={fieldLabelClass}>Bairro / Região *</span>
        <input name="neighborhood" type="text" required maxLength={80} defaultValue={zone?.neighborhood ?? ""} placeholder="Ex.: Moema" className={inputClass} />
      </label>

      <label className="block">
        <span className={fieldLabelClass}>Taxa de entrega (R$) *</span>
        <input
          name="delivery_fee"
          type="text"
          inputMode="decimal"
          required
          defaultValue={zone?.delivery_fee ?? ""}
          placeholder="5,00"
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className={fieldLabelClass}>Pedido mínimo (R$)</span>
        <input
          name="minimum_order_value"
          type="text"
          inputMode="decimal"
          defaultValue={zone?.minimum_order_value ?? ""}
          placeholder="Deixe em branco para usar o pedido mínimo global"
          className={inputClass}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={fieldLabelClass}>Tempo mín. (min)</span>
          <input
            name="estimated_time_min_minutes"
            type="text"
            inputMode="numeric"
            defaultValue={zone?.estimated_time_min_minutes ?? ""}
            placeholder="30"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className={fieldLabelClass}>Tempo máx. (min)</span>
          <input
            name="estimated_time_max_minutes"
            type="text"
            inputMode="numeric"
            defaultValue={zone?.estimated_time_max_minutes ?? ""}
            placeholder="45"
            className={inputClass}
          />
        </label>
      </div>

      {state.status === "error" && <ErrorState message={state.message ?? "Não foi possível salvar."} />}

      <SubmitButton label={submitLabel} />
    </form>
  );
}
