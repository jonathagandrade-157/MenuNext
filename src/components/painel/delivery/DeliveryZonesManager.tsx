"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Modal } from "@/components/ui/Modal";
import {
  createDeliveryZoneAction,
  deleteDeliveryZoneAction,
  toggleDeliveryZoneActiveAction,
  updateDeliveryZoneAction,
} from "@/lib/actions/deliveryZones";
import { formatCurrencyBRL } from "@/lib/products";
import type { DeliveryZone } from "@/lib/tenant";
import { DeliveryZoneFormFields } from "./DeliveryZoneFormFields";

/**
 * Zonas de entrega por bairro (área "Delivery" do redesign) — refinamento
 * opcional sobre a taxa global (DeliveryConfigForm, acima nesta mesma
 * página): se o bairro do endereço do cliente bater com uma zona ativa
 * (nome exato, sem acento/caixa), a taxa/pedido mínimo daqui prevalecem;
 * sem match, o checkout usa a configuração global de sempre — nunca
 * bloqueia um pedido por falta de zona cadastrada (create_order, ver
 * migration add_delivery_zones). Sem reordenação manual: a ordem não afeta
 * o pareamento, só cosmética — lista alfabética.
 */
export function DeliveryZonesManager({ initialZones }: { initialZones: DeliveryZone[] }) {
  const [zones, setZones] = useState(initialZones);
  const [syncedInitial, setSyncedInitial] = useState(initialZones);
  if (initialZones !== syncedInitial) {
    setSyncedInitial(initialZones);
    setZones(initialZones);
  }

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<DeliveryZone | null>(null);
  const [deleting, setDeleting] = useState<DeliveryZone | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleToggle(zone: DeliveryZone) {
    setRowError(null);
    setPendingId(zone.id);
    startTransition(async () => {
      const result = await toggleDeliveryZoneActiveAction(zone.id, !zone.is_active);
      setPendingId(null);
      if (!result.ok) setRowError(result.error ?? "Não foi possível atualizar.");
    });
  }

  function handleConfirmDelete() {
    if (!deleting) return;
    setDeleteError(null);
    setPendingId(deleting.id);
    startTransition(async () => {
      const result = await deleteDeliveryZoneAction(deleting.id);
      setPendingId(null);
      if (!result.ok) {
        setDeleteError(result.error ?? "Não foi possível excluir.");
        return;
      }
      setDeleting(null);
    });
  }

  return (
    <Card className="space-y-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-text-muted">Zonas de entrega por bairro</h2>
          <p className="mt-1 text-sm text-text-muted">
            Defina taxa, tempo e pedido mínimo específicos por bairro. Bairros sem zona cadastrada usam a configuração
            global acima.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="shrink-0">
          <span className="text-lg leading-none">+</span>
          Nova zona
        </Button>
      </div>

      {rowError && <ErrorState message={rowError} />}

      {zones.length === 0 ? (
        <EmptyState
          title="Nenhuma zona cadastrada ainda."
          description="Sem zonas, todos os pedidos usam a taxa e o raio de entrega globais configurados acima."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="hidden grid-cols-12 gap-4 border-b border-border bg-surface-subdued/70 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-text-muted md:grid">
            <div className="col-span-3">Bairro</div>
            <div className="col-span-2 text-center">Taxa</div>
            <div className="col-span-2 text-center">Tempo</div>
            <div className="col-span-2 text-center">Pedido mínimo</div>
            <div className="col-span-1 text-center">Status</div>
            <div className="col-span-2 text-right">Ações</div>
          </div>

          <div className="divide-y divide-border">
            {zones.map((zone) => {
              const isRowPending = isPending && pendingId === zone.id;
              const hasEstimate = zone.estimated_time_min_minutes !== null && zone.estimated_time_max_minutes !== null;
              return (
                <div
                  key={zone.id}
                  className="flex flex-col gap-2 p-3.5 md:grid md:grid-cols-12 md:items-center md:gap-4 md:px-4 md:py-3"
                >
                  <div className="md:col-span-3">
                    <span className="text-sm font-bold text-graphite">{zone.neighborhood}</span>
                  </div>
                  <div className="flex items-center justify-between md:col-span-2 md:justify-center">
                    <span className="md:hidden text-xs font-medium text-text-muted">Taxa:</span>
                    <span className="text-sm font-extrabold text-graphite">{formatCurrencyBRL(zone.delivery_fee)}</span>
                  </div>
                  <div className="flex items-center justify-between md:col-span-2 md:justify-center">
                    <span className="md:hidden text-xs font-medium text-text-muted">Tempo:</span>
                    <span className="text-sm text-graphite">
                      {hasEstimate ? `${zone.estimated_time_min_minutes}–${zone.estimated_time_max_minutes} min` : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between md:col-span-2 md:justify-center">
                    <span className="md:hidden text-xs font-medium text-text-muted">Pedido mínimo:</span>
                    <span className="text-sm text-graphite">
                      {zone.minimum_order_value !== null ? formatCurrencyBRL(zone.minimum_order_value) : "Global"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 md:col-span-1 md:justify-center">
                    <span className="md:hidden text-xs font-medium text-text-muted">Status:</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={zone.is_active}
                      disabled={isRowPending}
                      onClick={() => handleToggle(zone)}
                      className={`relative h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${
                        zone.is_active ? "bg-emerald" : "bg-surface-subdued"
                      }`}
                      title={zone.is_active ? "Ativa" : "Inativa"}
                    >
                      <span
                        className={`pointer-events-none block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                          zone.is_active ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                  <div className="flex items-center justify-end gap-1.5 border-t border-border pt-2 md:col-span-2 md:border-t-0 md:pt-0">
                    <button
                      type="button"
                      onClick={() => setEditing(zone)}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-graphite hover:bg-primary/10 hover:text-primary"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleting(zone);
                      }}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red hover:bg-red/10"
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nova zona de entrega">
        <DeliveryZoneFormFields action={createDeliveryZoneAction} submitLabel="Criar zona" onSuccess={() => setCreateOpen(false)} />
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Editar zona de entrega">
        {editing && (
          <DeliveryZoneFormFields
            action={updateDeliveryZoneAction}
            zone={editing}
            submitLabel="Salvar alterações"
            onSuccess={() => setEditing(null)}
          />
        )}
      </Modal>

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title="Excluir zona de entrega?">
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            Tem certeza que deseja excluir a zona <span className="font-semibold text-graphite">{deleting?.neighborhood}</span>?
            Pedidos desse bairro passam a usar a taxa global.
          </p>
          {deleteError && <ErrorState message={deleteError} />}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={isPending}>
              Cancelar
            </Button>
            <button
              type="button"
              onClick={handleConfirmDelete}
              disabled={isPending}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-red px-5 text-sm font-semibold text-white transition-all duration-150 hover:bg-[#dc2626] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending && pendingId === deleting?.id && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              )}
              Excluir
            </button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
