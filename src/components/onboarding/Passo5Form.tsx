"use client";

import { useActionState, useState } from "react";
import { savePasso5Action } from "@/lib/actions/onboarding";
import { initialStepState, WEEK_DAYS } from "@/lib/form-state";
import { ErrorMessage } from "@/components/onboarding/OnboardingShell";
import { SubmitButton } from "@/components/onboarding/SubmitButton";
import type { BusinessHour } from "@/lib/tenant";

export function Passo5Form({ businessHours }: { businessHours: BusinessHour[] }) {
  const [state, formAction] = useActionState(savePasso5Action, initialStepState);
  const byDay = new Map(businessHours.map((row) => [row.day_of_week, row]));
  const [openDays, setOpenDays] = useState<Record<number, boolean>>(
    Object.fromEntries(WEEK_DAYS.map(({ value }) => [value, byDay.get(value)?.is_open ?? false]))
  );

  return (
    <form action={formAction} className="space-y-3">
      {WEEK_DAYS.map(({ value, label }) => {
        const row = byDay.get(value);
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

      <ErrorMessage message={state.status === "error" ? state.message : undefined} />

      <SubmitButton label="Salvar e continuar" />
    </form>
  );
}
