"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { saveHorariosConfigAction } from "@/lib/actions/horarios";
import { initialHorariosState } from "@/lib/form-state";
import { Button } from "@/components/ui/Button";
import { WEEK_DAYS } from "@/lib/form-state";
import type { BusinessHour } from "@/lib/tenant";

const MAX_PERIODS_PER_DAY = 3;
const DEFAULT_PERIOD = { opensAt: "08:00", closesAt: "18:00" };

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full sm:w-auto" loading={pending} disabled={pending}>
      {pending ? "Salvando..." : "Salvar horários"}
    </Button>
  );
}

type Period = { opensAt: string; closesAt: string };

function groupPeriodsByDay(businessHours: BusinessHour[]): Record<number, Period[]> {
  const byDay: Record<number, Period[]> = {};
  for (const row of businessHours) {
    const list = byDay[row.day_of_week] ?? [];
    list[row.period_order - 1] = { opensAt: row.opens_at.slice(0, 5), closesAt: row.closes_at.slice(0, 5) };
    byDay[row.day_of_week] = list;
  }
  return byDay;
}

/**
 * Um dia pode ter até MAX_PERIODS_PER_DAY períodos (ex.: almoço/jantar com
 * intervalo fechado, área "Horários" do redesign — antes só 1 janela por
 * dia). Cada período vira 2 inputs nomeados opens_at_{dia}_{período} /
 * closes_at_{dia}_{período}, lidos por saveHorariosConfigAction; um hidden
 * period_count_{dia} informa quantos períodos aquele dia tem no submit.
 */
export function HorariosForm({ businessHours }: { businessHours: BusinessHour[] }) {
  const [state, formAction] = useActionState(saveHorariosConfigAction, initialHorariosState);

  const initialPeriods = groupPeriodsByDay(businessHours);
  const [openDays, setOpenDays] = useState<Record<number, boolean>>(
    Object.fromEntries(WEEK_DAYS.map(({ value }) => [value, (initialPeriods[value]?.length ?? 0) > 0]))
  );
  const [periodsByDay, setPeriodsByDay] = useState<Record<number, Period[]>>(
    Object.fromEntries(WEEK_DAYS.map(({ value }) => [value, initialPeriods[value]?.length ? initialPeriods[value] : [DEFAULT_PERIOD]]))
  );

  function addPeriod(day: number) {
    setPeriodsByDay((prev) => {
      const current = prev[day] ?? [];
      if (current.length >= MAX_PERIODS_PER_DAY) return prev;
      return { ...prev, [day]: [...current, DEFAULT_PERIOD] };
    });
  }

  function removePeriod(day: number, index: number) {
    setPeriodsByDay((prev) => {
      const current = prev[day] ?? [];
      if (current.length <= 1) return prev;
      return { ...prev, [day]: current.filter((_, i) => i !== index) };
    });
  }

  function updatePeriod(day: number, index: number, field: keyof Period, value: string) {
    setPeriodsByDay((prev) => {
      const current = [...(prev[day] ?? [])];
      current[index] = { ...current[index], [field]: value };
      return { ...prev, [day]: current };
    });
  }

  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-3">
        {WEEK_DAYS.map(({ value, label }) => {
          const isOpen = openDays[value];
          const periods = periodsByDay[value] ?? [];
          return (
            <div key={value} className="rounded-xl border border-border bg-surface-card p-4">
              <div className="flex items-center justify-between gap-3">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    name={`is_open_${value}`}
                    checked={isOpen}
                    onChange={(e) => setOpenDays((prev) => ({ ...prev, [value]: e.target.checked }))}
                    className="h-5 w-5 accent-primary"
                  />
                  <span className="text-sm font-semibold text-graphite">{label}</span>
                </label>
                {!isOpen && <span className="text-sm text-text-muted">Fechado</span>}
              </div>

              {isOpen && (
                <div className="mt-3 space-y-2 sm:pl-7">
                  <input type="hidden" name={`period_count_${value}`} value={periods.length} />
                  {periods.map((period, index) => (
                    <div key={index} className="flex flex-wrap items-center gap-2">
                      <input
                        type="time"
                        name={`opens_at_${value}_${index + 1}`}
                        value={period.opensAt}
                        onChange={(e) => updatePeriod(value, index, "opensAt", e.target.value)}
                        className="h-10 rounded-lg border border-border px-2 text-sm"
                      />
                      <span className="text-sm text-text-muted">às</span>
                      <input
                        type="time"
                        name={`closes_at_${value}_${index + 1}`}
                        value={period.closesAt}
                        onChange={(e) => updatePeriod(value, index, "closesAt", e.target.value)}
                        className="h-10 rounded-lg border border-border px-2 text-sm"
                      />
                      {periods.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removePeriod(value, index)}
                          className="text-xs font-semibold text-red hover:underline"
                        >
                          Remover período
                        </button>
                      )}
                    </div>
                  ))}
                  {periods.length < MAX_PERIODS_PER_DAY && (
                    <button
                      type="button"
                      onClick={() => addPeriod(value)}
                      className="text-xs font-semibold text-primary hover:underline"
                    >
                      + Adicionar período
                    </button>
                  )}
                </div>
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
