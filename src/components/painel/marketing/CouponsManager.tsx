"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Modal } from "@/components/ui/Modal";
import { createCouponAction, deleteCouponAction, toggleCouponActiveAction, updateCouponAction } from "@/lib/actions/coupons";
import { formatCurrencyBRL } from "@/lib/products";
import type { Coupon } from "@/lib/tenant";
import { CouponFormFields } from "./CouponFormFields";

function formatDiscount(coupon: Coupon): string {
  return coupon.discount_type === "percent" ? `${coupon.discount_value}% OFF` : `${formatCurrencyBRL(coupon.discount_value)} OFF`;
}

function formatExpiresAt(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function isExpired(coupon: Coupon): boolean {
  return coupon.expires_at !== null && new Date(coupon.expires_at) < new Date();
}

/**
 * Cupons de Desconto (área "Marketing" do redesign — só esta peça do
 * mockup completo, ver migration add_coupons). Código digitado pelo
 * cliente no checkout; create_order valida tudo de novo no momento da
 * redenção (nunca confia só no preview feito aqui ou no checkout).
 */
export function CouponsManager({ initialCoupons }: { initialCoupons: Coupon[] }) {
  const [coupons, setCoupons] = useState(initialCoupons);
  const [syncedInitial, setSyncedInitial] = useState(initialCoupons);
  if (initialCoupons !== syncedInitial) {
    setSyncedInitial(initialCoupons);
    setCoupons(initialCoupons);
  }

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [deleting, setDeleting] = useState<Coupon | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const activeCount = coupons.filter((c) => c.is_active && !isExpired(c)).length;
  const totalUses = coupons.reduce((sum, c) => sum + c.uses_count, 0);

  function handleToggle(coupon: Coupon) {
    setRowError(null);
    setPendingId(coupon.id);
    startTransition(async () => {
      const result = await toggleCouponActiveAction(coupon.id, !coupon.is_active);
      setPendingId(null);
      if (!result.ok) setRowError(result.error ?? "Não foi possível atualizar.");
    });
  }

  function handleConfirmDelete() {
    if (!deleting) return;
    setDeleteError(null);
    setPendingId(deleting.id);
    startTransition(async () => {
      const result = await deleteCouponAction(deleting.id);
      setPendingId(null);
      if (!result.ok) {
        setDeleteError(result.error ?? "Não foi possível excluir.");
        return;
      }
      setDeleting(null);
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium text-text-muted">Total de cupons</p>
          <p className="mt-1 text-2xl font-black text-graphite">{coupons.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-text-muted">Ativos</p>
          <p className="mt-1 text-2xl font-black text-emerald">{activeCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-text-muted">Usos totais</p>
          <p className="mt-1 text-2xl font-black text-graphite">{totalUses}</p>
        </Card>
      </div>

      <Card className="space-y-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-text-muted">Cupons de desconto</h2>
            <p className="mt-1 text-sm text-text-muted">
              O cliente digita o código no checkout da loja pública para ativar o desconto.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="shrink-0">
            <span className="text-lg leading-none">+</span>
            Novo cupom
          </Button>
        </div>

        {rowError && <ErrorState message={rowError} />}

        {coupons.length === 0 ? (
          <EmptyState
            title="Nenhum cupom cadastrado ainda."
            description="Crie um código promocional para seus clientes usarem no checkout."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="hidden grid-cols-12 gap-4 border-b border-border bg-surface-subdued/70 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-text-muted md:grid">
              <div className="col-span-3">Código</div>
              <div className="col-span-2 text-center">Desconto</div>
              <div className="col-span-2 text-center">Pedido mínimo</div>
              <div className="col-span-2 text-center">Usos</div>
              <div className="col-span-1 text-center">Status</div>
              <div className="col-span-2 text-right">Ações</div>
            </div>

            <div className="divide-y divide-border">
              {coupons.map((coupon) => {
                const isRowPending = isPending && pendingId === coupon.id;
                const expired = isExpired(coupon);
                const limitReached = coupon.max_uses !== null && coupon.uses_count >= coupon.max_uses;
                return (
                  <div
                    key={coupon.id}
                    className="flex flex-col gap-2 p-3.5 md:grid md:grid-cols-12 md:items-center md:gap-4 md:px-4 md:py-3"
                  >
                    <div className="md:col-span-3">
                      <span className="text-sm font-bold text-graphite">{coupon.code}</span>
                      {coupon.expires_at && (
                        <p className={`text-xs ${expired ? "font-semibold text-red" : "text-text-muted"}`}>
                          {expired ? "Expirou em " : "Válido até "}
                          {formatExpiresAt(coupon.expires_at)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-between md:col-span-2 md:justify-center">
                      <span className="md:hidden text-xs font-medium text-text-muted">Desconto:</span>
                      <span className="text-sm font-extrabold text-graphite">{formatDiscount(coupon)}</span>
                    </div>
                    <div className="flex items-center justify-between md:col-span-2 md:justify-center">
                      <span className="md:hidden text-xs font-medium text-text-muted">Pedido mínimo:</span>
                      <span className="text-sm text-graphite">
                        {coupon.min_order_value !== null ? formatCurrencyBRL(coupon.min_order_value) : "Sem mínimo"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between md:col-span-2 md:justify-center">
                      <span className="md:hidden text-xs font-medium text-text-muted">Usos:</span>
                      <span className={`text-sm font-semibold ${limitReached ? "text-red" : "text-graphite"}`}>
                        {coupon.uses_count}
                        {coupon.max_uses !== null ? ` / ${coupon.max_uses}` : ""}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 md:col-span-1 md:justify-center">
                      <span className="md:hidden text-xs font-medium text-text-muted">Status:</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={coupon.is_active}
                        disabled={isRowPending}
                        onClick={() => handleToggle(coupon)}
                        className={`relative h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${
                          coupon.is_active ? "bg-emerald" : "bg-surface-subdued"
                        }`}
                        title={coupon.is_active ? "Ativo" : "Inativo"}
                      >
                        <span
                          className={`pointer-events-none block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                            coupon.is_active ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                    <div className="flex items-center justify-end gap-1.5 border-t border-border pt-2 md:col-span-2 md:border-t-0 md:pt-0">
                      <button
                        type="button"
                        onClick={() => setEditing(coupon)}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-graphite hover:bg-primary/10 hover:text-primary"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteError(null);
                          setDeleting(coupon);
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
      </Card>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Novo cupom">
        <CouponFormFields action={createCouponAction} submitLabel="Criar cupom" onSuccess={() => setCreateOpen(false)} />
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Editar cupom">
        {editing && (
          <CouponFormFields action={updateCouponAction} coupon={editing} submitLabel="Salvar alterações" onSuccess={() => setEditing(null)} />
        )}
      </Modal>

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title="Excluir cupom?">
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            Tem certeza que deseja excluir o cupom <span className="font-semibold text-graphite">{deleting?.code}</span>? Ele
            deixa de funcionar no checkout imediatamente.
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
    </div>
  );
}
