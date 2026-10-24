"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Copy, Plus, X } from "lucide-react";
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

  /** Copia o estado (aberto/fechado) e os turnos de um dia para todos os outros. */
  function copyToAll(sourceDay: number) {
    const sourceOpen = openDays[sourceDay];
    const sourcePeriods = periodsByDay[sourceDay] ?? [DEFAULT_PERIOD];
    setOpenDays(Object.fromEntries(WEEK_DAYS.map(({ value }) => [value, sourceOpen])));
    setPeriodsByDay(Object.fromEntries(WEEK_DAYS.map(({ value }) => [value, sourcePeriods.map((p) => ({ ...p }))])));
  }

  function updatePeriod(day: number, index: number, field: keyof Period, value: string) {
    setPeriodsByDay((prev) => {
      const current = [...(prev[day] ?? [])];
      current[index] = { ...current[index], [field]: value };
      return { ...prev, [day]: current };
    });
  }

  const firstOpenDay = WEEK_DAYS.find(({ value }) => openDays[value])?.value;
  const TIME_INPUT =
    "h-10 rounded-xl border border-border bg-surface px-2.5 text-body-md text-graphite focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

  return (
    <form action={formAction} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-md text-text-muted">
          Cada dia pode ter até {MAX_PERIODS_PER_DAY} turnos (por exemplo, almoço e jantar).
        </p>
        {firstOpenDay !== undefined && (
          <button
            type="button"
            onClick={() => copyToAll(firstOpenDay)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface-card px-3 text-label-md text-graphite hover:bg-surface-subdued"
          >
            <Copy className="h-4 w-4" aria-hidden />
            Copiar {WEEK_DAYS.find(({ value }) => value === firstOpenDay)?.label.toLowerCase()} para todos os dias
          </button>
        )}
      </div>

      <div className="space-y-3">
        {WEEK_DAYS.map(({ value, label }) => {
          const isOpen = openDays[value];
          const periods = periodsByDay[value] ?? [];
          return (
            <div key={value} className={`rounded-2xl border p-4 ${isOpen ? "border-border bg-surface-card" : "border-border bg-surface-subdued/60"}`}>
              <div className="flex items-center justify-between gap-3">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    name={`is_open_${value}`}
                    checked={isOpen}
                    onChange={(e) => setOpenDays((prev) => ({ ...prev, [value]: e.target.checked }))}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden
                    className="relative h-6 w-11 shrink-0 rounded-full bg-border transition-colors peer-checked:bg-emerald peer-focus-visible:ring-[3px] peer-focus-visible:ring-primary/30 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5"
                  />
                  <span className="text-body-lg font-bold text-graphite">{label}</span>
                </label>
                <span className={`rounded-full px-2.5 py-0.5 text-label-sm ${isOpen ? "bg-emerald/10 text-emerald" : "bg-surface-subdued text-text-muted"}`}>
                  {isOpen ? "Aberto" : "Fechado"}
                </span>
              </div>

              {isOpen && (
                <div className="mt-3 space-y-2 sm:pl-14">
                  <input type="hidden" name={`period_count_${value}`} value={periods.length} />
                  {periods.map((period, index) => (
                    <div key={index} className="flex flex-wrap items-center gap-2">
                      {periods.length > 1 && <span className="w-14 text-label-md text-text-muted">Turno {index + 1}</span>}
                      <input
                        type="time"
                        name={`opens_at_${value}_${index + 1}`}
                        value={period.opensAt}
                        onChange={(e) => updatePeriod(value, index, "opensAt", e.target.value)}
                        aria-label={`${label}: abre às`}
                        className={TIME_INPUT}
                      />
                      <span className="text-body-md text-text-muted">às</span>
                      <input
                        type="time"
                        name={`closes_at_${value}_${index + 1}`}
                        value={period.closesAt}
                        onChange={(e) => updatePeriod(value, index, "closesAt", e.target.value)}
                        aria-label={`${label}: fecha às`}
                        className={TIME_INPUT}
                      />
                      {periods.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removePeriod(value, index)}
                          aria-label={`Remover turno ${index + 1} de ${label}`}
                          className="rounded-lg p-1.5 text-text-muted hover:bg-red/10 hover:text-red"
                        >
                          <X className="h-4 w-4" aria-hidden />
                        </button>
                      )}
                    </div>
                  ))}
                  {periods.length < MAX_PERIODS_PER_DAY && (
                    <button
                      type="button"
                      onClick={() => addPeriod(value)}
                      className="inline-flex items-center gap-1 text-label-md text-primary hover:underline"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      Adicionar período
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {state.status === "error" && (
        <div className="rounded-xl border border-red/20 bg-red/10 px-3.5 py-2.5 text-body-md font-medium text-red">
          {state.message}
        </div>
      )}
      {state.status === "success" && (
        <div className="rounded-xl border border-emerald/20 bg-emerald/10 px-3.5 py-2.5 text-body-md font-medium text-emerald">
          Horários salvos com sucesso.
        </div>
      )}

      <SaveButton />
    </form>
  );
}
