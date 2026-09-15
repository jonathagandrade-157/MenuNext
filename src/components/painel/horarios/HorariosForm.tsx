"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { saveHorariosConfigAction } from "@/lib/actions/horarios";
import { initialHorariosState } from "@/lib/form-state";
import { Button } from "@/components/ui/Button";
import { WEEK_DAYS } from "@/lib/form-state";
import type { BusinessHour } from "@/lib/tenant";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full sm:w-auto" loading={pending} disabled={pending}>
      {pending ? "Salvando..." : "Salvar horários"}
    </Button>
  );
}

/**
 * Mesma UI de dias/horários do Passo 5 do onboarding (Passo5Form), sem o
 * rodapé de navegação de etapa (Voltar/Pular) — aqui é só "Salvar", e
 * salvar mantém o lojista em /painel/horarios.
 */
export function HorariosForm({ businessHours }: { businessHours: BusinessHour[] }) {
  const [state, formAction] = useActionState(saveHorariosConfigAction, initialHorariosState);
  const byDay = new Map(businessHours.map((row) => [row.day_of_week, row]));
  const [openDays, setOpenDays] = useState<Record<number, boolean>>(
    Object.fromEntries(WEEK_DAYS.map(({ value }) => [value, byDay.get(value)?.is_open ?? false]))
  );

  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-3">
        {WEEK_DAYS.map(({ value, label }) => {
          const row = byDay.get(value);
          const isOpen = openDays[value];
          return (
            <div
              key={value}
              className="flex flex-col gap-3 rounded-xl border border-border bg-surface-card p-4 sm:flex-row sm:items-center"
            >
              <label className="flex w-36 shrink-0 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  name={`is_open_${value}`}
                  checked={isOpen}
                  onChange={(e) => setOpenDays((prev) => ({ ...prev, [value]: e.target.checked }))}
                  className="h-5 w-5 accent-primary"
                />
                <span className="text-sm font-semibold text-graphite">{label}</span>
              </label>
              {isOpen ? (
                <div className="flex flex-1 items-center gap-2">
                  <input
                    type="time"
                    name={`opens_at_${value}`}
                    defaultValue={row?.opens_at?.slice(0, 5) ?? "08:00"}
                    className="h-10 rounded-lg border border-border px-2 text-sm"
                  />
                  <span className="text-sm text-text-muted">às</span>
                  <input
                    type="time"
                    name={`closes_at_${value}`}
                    defaultValue={row?.closes_at?.slice(0, 5) ?? "18:00"}
                    className="h-10 rounded-lg border border-border px-2 text-sm"
                  />
                </div>
              ) : (
                <span className="text-sm text-text-muted">Fechado</span>
              )}
            </div>
          );
        })}
      </div>

      {state.status === "error" && (
        <div className="rounded-lg border border-[#FEF2F2] bg-[#FEF2F2] px-3 py-2 text-sm font-medium text-red">
          {state.message}
        </div>
      )}
      {state.status === "success" && (
        <div className="rounded-lg border border-[#ECFDF5] bg-[#ECFDF5] px-3 py-2 text-sm font-medium text-emerald">
          Horários salvos com sucesso.
        </div>
      )}

      <SaveButton />
    </form>
  );
}
