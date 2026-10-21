"use client";

import { useActionState, useState } from "react";
import { Copy } from "lucide-react";
import { savePasso5Action, skipOnboardingStepAction } from "@/lib/actions/onboarding";
import { initialStepState, WEEK_DAYS } from "@/lib/form-state";
import { ErrorMessage, StepNavigation } from "@/components/onboarding/OnboardingShell";
import type { BusinessHour } from "@/lib/tenant";

const skipStep5 = skipOnboardingStepAction.bind(null, 5);

export function Passo5Form({ businessHours }: { businessHours: BusinessHour[] }) {
  const [state, formAction] = useActionState(savePasso5Action, initialStepState);
  // Passo 5 só lê/escreve period_order=1 por dia (formulário de múltiplos
  // turnos é só no painel, /painel/horarios) — presença de QUALQUER período
  // no dia conta como aberto, mesmo que period_order 1 especificamente não
  // exista (caso raro: lojista configurou turnos só pelo painel).
  const firstPeriodByDay = new Map(businessHours.filter((row) => row.period_order === 1).map((row) => [row.day_of_week, row]));
  const openDaysSet = new Set(businessHours.map((row) => row.day_of_week));
  const [openDays, setOpenDays] = useState<Record<number, boolean>>(
    Object.fromEntries(WEEK_DAYS.map(({ value }) => [value, openDaysSet.has(value)]))
  );

  // Horários controlados: permitem "copiar para todos os dias" sem digitar sete vezes.
  const [times, setTimes] = useState<Record<number, { opens: string; closes: string }>>(
    Object.fromEntries(
      WEEK_DAYS.map(({ value }) => {
        const row = firstPeriodByDay.get(value);
        return [value, { opens: row?.opens_at?.slice(0, 5) ?? "08:00", closes: row?.closes_at?.slice(0, 5) ?? "18:00" }];
      })
    )
  );
  const firstOpenDay = WEEK_DAYS.find(({ value }) => openDays[value]);

  function copyToAllDays() {
    if (!firstOpenDay) return;
    const source = times[firstOpenDay.value];
    setOpenDays(Object.fromEntries(WEEK_DAYS.map(({ value }) => [value, true])));
    setTimes(Object.fromEntries(WEEK_DAYS.map(({ value }) => [value, { ...source }])));
  }

  return (
    <form action={formAction} className="space-y-3">
      {firstOpenDay && (
        <button
          type="button"
          onClick={copyToAllDays}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface-card px-3 text-label-md text-graphite hover:bg-surface-subdued"
        >
          <Copy className="h-4 w-4" aria-hidden />
          Usar o horário de {firstOpenDay.label.toLowerCase()} em todos os dias
        </button>
      )}
      {WEEK_DAYS.map(({ value, label }) => {
        const isOpen = openDays[value];
        return (
          <div key={value} className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center">
            <label className="flex w-36 shrink-0 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                name={`is_open_${value}`}
                checked={isOpen}
                onChange={(e) => setOpenDays((prev) => ({ ...prev, [value]: e.target.checked }))}
                className="h-5 w-5 accent-primary"
              />
              <span className="text-label-lg text-graphite">{label}</span>
            </label>
            {isOpen ? (
              <div className="flex flex-1 items-center gap-2">
                <input
                  type="time"
                  name={`opens_at_${value}`}
                  value={times[value].opens}
                  onChange={(e) => setTimes((prev) => ({ ...prev, [value]: { ...prev[value], opens: e.target.value } }))}
                  className="h-10 rounded-xl border border-border px-2 text-body-md"
                />
                <span className="text-body-md text-text-muted">às</span>
                <input
                  type="time"
                  name={`closes_at_${value}`}
                  value={times[value].closes}
                  onChange={(e) => setTimes((prev) => ({ ...prev, [value]: { ...prev[value], closes: e.target.value } }))}
                  className="h-10 rounded-xl border border-border px-2 text-body-md"
                />
              </div>
            ) : (
              <span className="text-body-md text-text-muted">Fechado</span>
            )}
          </div>
        );
      })}

      <ErrorMessage message={state.status === "error" ? state.message : undefined} />

      <StepNavigation backHref="/onboarding/passo-4" skipAction={skipStep5} submitLabel="Salvar e continuar" />
    </form>
  );
}
