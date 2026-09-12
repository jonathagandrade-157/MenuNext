"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { saveDeliveryConfigAction, initialDeliveryConfigState } from "@/lib/actions/delivery";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { Restaurant } from "@/lib/tenant";
import type { BusinessHour } from "@/lib/tenant";
import { WEEK_DAYS } from "@/lib/form-state";

const inputClass =
  "h-11 w-full rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

const fieldLabelClass = "mb-1.5 block text-sm font-semibold text-graphite";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full sm:w-auto" loading={pending} disabled={pending}>
      {pending ? "Salvando..." : "Salvar configuração"}
    </Button>
  );
}

function openDaysSummary(businessHours: BusinessHour[]): string {
  const openDays = WEEK_DAYS.filter((day) => businessHours.find((h) => h.day_of_week === day.value)?.is_open);
  if (openDays.length === 0) return "Nenhum dia configurado ainda.";
  if (openDays.length === 7) return "Todos os dias da semana.";
  return openDays.map((d) => d.label).join(", ");
}

export function DeliveryConfigForm({ restaurant, businessHours }: { restaurant: Restaurant; businessHours: BusinessHour[] }) {
  const [state, formAction] = useActionState(saveDeliveryConfigAction, initialDeliveryConfigState);

  return (
    <form action={formAction} className="space-y-6">
      <Card className="p-6">
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
          <input
            type="checkbox"
            name="service_delivery"
            defaultChecked={restaurant.service_delivery}
            className="mt-0.5 h-5 w-5 accent-primary"
          />
          <span>
            <span className="block text-sm font-semibold text-graphite">Delivery ativo</span>
            <span className="block text-sm text-text-muted">
              Com o delivery desativado, sua loja pública não aceita novos pedidos — mas nada aqui é apagado.
            </span>
          </span>
        </label>
      </Card>

      <Card className="space-y-5 p-6">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-text-muted">Taxa e área de entrega</h2>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <span className={fieldLabelClass}>Taxa de entrega (R$)</span>
            <input
              name="delivery_fee"
              type="text"
              inputMode="decimal"
              defaultValue={restaurant.delivery_fee ?? ""}
              placeholder="8,00"
              className={inputClass}
            />
          </div>
          <div>
            <span className={fieldLabelClass}>Raio máximo de entrega (km)</span>
            <input
              name="delivery_radius_km"
              type="text"
              inputMode="decimal"
              defaultValue={restaurant.delivery_radius_km ?? ""}
              placeholder="5"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <span className={fieldLabelClass}>Pedido mínimo (R$)</span>
          <input
            name="minimum_order_value"
            type="text"
            inputMode="decimal"
            defaultValue={restaurant.minimum_order_value ?? ""}
            placeholder="Deixe em branco para não exigir um valor mínimo"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-text-muted">
            Se preenchido, pedidos abaixo desse valor são recusados automaticamente no checkout.
          </p>
        </div>
      </Card>

      <Card className="space-y-5 p-6">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-text-muted">Tempo estimado de entrega</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <span className={fieldLabelClass}>De (minutos)</span>
            <input
              name="estimated_delivery_min_minutes"
              type="text"
              inputMode="numeric"
              defaultValue={restaurant.estimated_delivery_min_minutes ?? ""}
              placeholder="30"
              className={inputClass}
            />
          </div>
          <div>
            <span className={fieldLabelClass}>Até (minutos)</span>
            <input
              name="estimated_delivery_max_minutes"
              type="text"
              inputMode="numeric"
              defaultValue={restaurant.estimated_delivery_max_minutes ?? ""}
              placeholder="50"
              className={inputClass}
            />
          </div>
        </div>
        <p className="text-xs text-text-muted">
          Exibido para o cliente na loja pública e no acompanhamento do pedido. Deixe os dois campos em branco para não mostrar uma estimativa.
        </p>
      </Card>

      <Card className="space-y-2 p-6">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-text-muted">Dias e horários que aceitam delivery</h2>
        <p className="text-sm text-graphite">{openDaysSummary(businessHours)}</p>
        <Link href="/onboarding/passo-5" className="inline-block text-sm font-semibold text-primary hover:underline">
          Editar horários de funcionamento →
        </Link>
      </Card>

      {state.status === "error" && (
        <div className="rounded-lg border border-[#FEF2F2] bg-[#FEF2F2] px-3 py-2 text-sm font-medium text-red">
          {state.message}
        </div>
      )}
      {state.status === "success" && (
        <div className="rounded-lg border border-[#ECFDF5] bg-[#ECFDF5] px-3 py-2 text-sm font-medium text-emerald">
          Configuração salva com sucesso.
        </div>
      )}

      <SaveButton />
    </form>
  );
}
