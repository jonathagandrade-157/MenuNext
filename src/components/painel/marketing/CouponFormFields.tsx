"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import { initialCouponState, type CouponActionState } from "@/lib/form-state";
import type { Coupon } from "@/lib/tenant";

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

/** Formulário de Novo/Editar cupom — mesmo corpo para os dois casos (mesmo
 * padrão de DeliveryZoneFormFields). expires_at é tratado como data pura
 * (yyyy-mm-dd) no input e convertido para fim do dia (23:59:59) na Server
 * Action, já que o cupom deve valer o dia inteiro da validade. */
export function CouponFormFields({
  action,
  coupon,
  submitLabel,
  onSuccess,
}: {
  action: (prev: CouponActionState, formData: FormData) => Promise<CouponActionState>;
  coupon?: Coupon;
  submitLabel: string;
  onSuccess: () => void;
}) {
  const [state, formAction] = useActionState(action, initialCouponState);
  const [discountType, setDiscountType] = useState<"percent" | "fixed">(coupon?.discount_type ?? "percent");

  useEffect(() => {
    if (state.status === "success") onSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  return (
    <form action={formAction} className="space-y-4">
      {coupon && <input type="hidden" name="couponId" value={coupon.id} />}

      <label className="block">
        <span className={fieldLabelClass}>Código do cupom *</span>
        <input
          name="code"
          type="text"
          required
          maxLength={30}
          defaultValue={coupon?.code ?? ""}
          placeholder="Ex.: BEMVINDO10"
          className={`${inputClass} uppercase`}
          style={{ textTransform: "uppercase" }}
        />
      </label>

      <div>
        <span className={fieldLabelClass}>Tipo de desconto *</span>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDiscountType("percent")}
            className={`rounded-lg border px-3 py-2.5 text-sm font-bold transition-colors ${
              discountType === "percent" ? "border-primary bg-primary/10 text-primary" : "border-border text-graphite hover:bg-surface-subdued"
            }`}
          >
            % Percentual
          </button>
          <button
            type="button"
            onClick={() => setDiscountType("fixed")}
            className={`rounded-lg border px-3 py-2.5 text-sm font-bold transition-colors ${
              discountType === "fixed" ? "border-primary bg-primary/10 text-primary" : "border-border text-graphite hover:bg-surface-subdued"
            }`}
          >
            R$ Fixo
          </button>
        </div>
        <input type="hidden" name="discount_type" value={discountType} />
      </div>

      <label className="block">
        <span className={fieldLabelClass}>{discountType === "percent" ? "Desconto (%) *" : "Desconto (R$) *"}</span>
        <input
          name="discount_value"
          type="text"
          inputMode="decimal"
          required
          defaultValue={coupon?.discount_value ?? ""}
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
          defaultValue={coupon?.min_order_value ?? ""}
          placeholder="Deixe em branco para não exigir mínimo"
          className={inputClass}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={fieldLabelClass}>Limite de usos</span>
          <input
            name="max_uses"
            type="text"
            inputMode="numeric"
            defaultValue={coupon?.max_uses ?? ""}
            placeholder="Ilimitado"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className={fieldLabelClass}>Válido até</span>
          <input
            name="expires_at"
            type="date"
            defaultValue={coupon?.expires_at ? coupon.expires_at.slice(0, 10) : ""}
            className={inputClass}
          />
        </label>
      </div>

      {state.status === "error" && <ErrorState message={state.message ?? "Não foi possível salvar."} />}

      <SubmitButton label={submitLabel} />
    </form>
  );
}
