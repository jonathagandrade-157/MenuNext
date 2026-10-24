"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import { initialPromotionState, type PromotionActionState } from "@/lib/form-state";
import { WEEKDAY_LABELS, toDateInput, type Promotion } from "@/lib/promotions";

const inputClass =
  "h-11 w-full rounded-lg border border-border bg-surface-card px-3 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

const fieldLabelClass = "mb-1.5 block text-label-lg text-graphite";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" loading={pending} disabled={pending}>
      {pending ? "Salvando..." : label}
    </Button>
  );
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

/** Formulário de Nova/Editar promoção — mesmo corpo para os dois casos (padrão de CouponFormFields).
 * Datas e horários são do fuso de São Paulo; a janela de horário não atravessa a meia-noite. */
export function PromotionFormFields({
  action,
  promotion,
  submitLabel,
  onSuccess,
}: {
  action: (prev: PromotionActionState, formData: FormData) => Promise<PromotionActionState>;
  promotion?: Promotion;
  submitLabel: string;
  onSuccess: () => void;
}) {
  const [state, formAction] = useActionState(action, initialPromotionState);
  const [discountType, setDiscountType] = useState<"percent" | "fixed">(promotion?.discount_type ?? "percent");

  useEffect(() => {
    if (state.status === "success") onSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  return (
    <form action={formAction} className="space-y-4">
      {promotion && <input type="hidden" name="promotionId" value={promotion.id} />}

      <label className="block">
        <span className={fieldLabelClass}>Nome da promoção *</span>
        <input
          name="name"
          type="text"
          required
          maxLength={60}
          defaultValue={promotion?.name ?? ""}
          placeholder="Ex.: Happy hour de sexta"
          className={inputClass}
        />
        <span className="mt-1 block text-body-sm text-text-muted">O cliente vê este nome no checkout.</span>
      </label>

      <div>
        <span className={fieldLabelClass}>Tipo de desconto *</span>
        <div className="grid grid-cols-2 gap-2">
          {(["percent", "fixed"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setDiscountType(type)}
              className={`rounded-lg border px-3 py-2.5 text-body-md font-bold transition-colors ${
                discountType === type ? "border-primary bg-primary/10 text-primary" : "border-border text-graphite hover:bg-surface-subdued"
              }`}
            >
              {type === "percent" ? "% Percentual" : "R$ Fixo"}
            </button>
          ))}
        </div>
        <input type="hidden" name="discount_type" value={discountType} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={fieldLabelClass}>{discountType === "percent" ? "Desconto (%) *" : "Desconto (R$) *"}</span>
          <input
            name="discount_value"
            type="text"
            inputMode="decimal"
            required
            defaultValue={promotion?.discount_value ?? ""}
            placeholder={discountType === "percent" ? "10" : "10,00"}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className={fieldLabelClass}>Pedido mínimo (R$)</span>
          <input
            name="min_order_value"
            type="text"
            inputMode="decimal"
            defaultValue={promotion?.min_order_value ?? ""}
            placeholder="Sem mínimo"
            className={inputClass}
          />
        </label>
      </div>

      <fieldset>
        <legend className={fieldLabelClass}>Dias da semana</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAY_LABELS.map((label, day) => (
            <label key={day} className="cursor-pointer">
              <input
                type="checkbox"
                name="weekdays"
                value={day}
                defaultChecked={promotion?.weekdays?.includes(day) ?? false}
                className="peer sr-only"
              />
              <span className="inline-flex h-10 min-w-12 items-center justify-center rounded-lg border border-border px-3 text-label-md font-bold text-graphite transition-colors hover:bg-surface-subdued peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:text-primary peer-focus-visible:ring-[3px] peer-focus-visible:ring-primary/30">
                {label}
              </span>
            </label>
          ))}
        </div>
        <span className="mt-1 block text-body-sm text-text-muted">Nenhum marcado = todos os dias.</span>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={fieldLabelClass}>Horário de início</span>
          <input name="time_from" type="time" defaultValue={hhmm(promotion?.time_from ?? null)} className={inputClass} />
        </label>
        <label className="block">
          <span className={fieldLabelClass}>Horário de fim</span>
          <input name="time_to" type="time" defaultValue={hhmm(promotion?.time_to ?? null)} className={inputClass} />
        </label>
      </div>
      <p className="-mt-2 text-body-sm text-text-muted">Em branco = o dia todo. A janela não atravessa a meia-noite.</p>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={fieldLabelClass}>Começa em</span>
          <input name="starts_on" type="date" defaultValue={toDateInput(promotion?.starts_at ?? null)} className={inputClass} />
        </label>
        <label className="block">
          <span className={fieldLabelClass}>Termina em</span>
          <input name="ends_on" type="date" defaultValue={toDateInput(promotion?.ends_at ?? null)} className={inputClass} />
        </label>
      </div>

      {state.status === "error" && <ErrorState message={state.message ?? "Não foi possível salvar."} />}

      <SubmitButton label={submitLabel} />
    </form>
  );
}
