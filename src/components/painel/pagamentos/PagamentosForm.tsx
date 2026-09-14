"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { savePagamentosConfigAction, initialPagamentosState } from "@/lib/actions/pagamentos";
import { Button } from "@/components/ui/Button";
import type { Restaurant } from "@/lib/tenant";

const inputClass =
  "h-11 w-full rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

const fieldLabelClass = "mb-1.5 block text-sm font-semibold text-graphite";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full sm:w-auto" loading={pending} disabled={pending}>
      {pending ? "Salvando..." : "Salvar formas de pagamento"}
    </Button>
  );
}

/**
 * Mesma UI de formas de pagamento do Passo 6 do onboarding (Passo6Form), sem
 * o rodapé de navegação de etapa — aqui é só "Salvar", e salvar mantém o
 * lojista em /painel/pagamentos.
 */
export function PagamentosForm({ restaurant }: { restaurant: Restaurant }) {
  const [state, formAction] = useActionState(savePagamentosConfigAction, initialPagamentosState);
  const [pixEnabled, setPixEnabled] = useState(restaurant.payment_pix);

  return (
    <form action={formAction} className="space-y-4">
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-card p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
        <input
          type="checkbox"
          name="payment_pix"
          checked={pixEnabled}
          onChange={(e) => setPixEnabled(e.target.checked)}
          className="mt-0.5 h-5 w-5 accent-primary"
        />
        <span className="flex-1">
          <span className="block text-sm font-semibold text-graphite">Pix</span>
          <span className="block text-sm text-text-muted">O cliente paga direto na sua chave Pix.</span>
          {pixEnabled && (
            <div className="mt-3">
              <span className={fieldLabelClass}>Chave Pix do restaurante *</span>
              <input
                name="payment_pix_key"
                type="text"
                defaultValue={restaurant.payment_pix_key ?? ""}
                placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória"
                className={inputClass}
              />
            </div>
          )}
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-card p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
        <input
          type="checkbox"
          name="payment_cash"
          defaultChecked={restaurant.payment_cash}
          className="mt-0.5 h-5 w-5 accent-primary"
        />
        <span className="block text-sm font-semibold text-graphite">Dinheiro</span>
      </label>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-card p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
        <input
          type="checkbox"
          name="payment_card"
          defaultChecked={restaurant.payment_card}
          className="mt-0.5 h-5 w-5 accent-primary"
        />
        <span className="block text-sm font-semibold text-graphite">Maquininha / cartão na entrega ou retirada</span>
      </label>

      {state.status === "error" && (
        <div className="rounded-lg border border-[#FEF2F2] bg-[#FEF2F2] px-3 py-2 text-sm font-medium text-red">
          {state.message}
        </div>
      )}
      {state.status === "success" && (
        <div className="rounded-lg border border-[#ECFDF5] bg-[#ECFDF5] px-3 py-2 text-sm font-medium text-emerald">
          Formas de pagamento salvas com sucesso.
        </div>
      )}

      <SaveButton />
    </form>
  );
}
