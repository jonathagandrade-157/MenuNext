"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { toggleRestaurantStatusAction } from "@/lib/actions/configuracoes";

/**
 * Barra de status do Dashboard (redesign Stitch) — versão compacta do
 * StoreStatusCard (Configurações): mesmo toggle pausar/reabrir (reaproveita
 * toggleRestaurantStatusAction, nenhuma lógica nova), mais a contagem de
 * produtos indisponíveis com link direto para resolver.
 */
export function StoreStatusBar({
  initialStatus,
  unavailableProductCount,
}: {
  initialStatus: "active" | "paused";
  unavailableProductCount: number;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isActive = status === "active";

  function handleToggle() {
    setError(null);
    const nextStatus = isActive ? "paused" : "active";
    startTransition(async () => {
      const result = await toggleRestaurantStatusAction(nextStatus);
      if (!result.ok) {
        setError(result.error ?? "Não foi possível atualizar o status da loja.");
        return;
      }
      setStatus(nextStatus);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-card px-4 py-3">
        <div className="flex items-center gap-3">
          <Badge tone={isActive ? "success" : "neutral"} pulse={isActive}>
            {isActive ? "Loja Aberta" : "Loja Pausada"}
          </Badge>
          <p className="text-sm text-text-muted">
            {isActive ? "Recebendo pedidos normalmente" : "Cardápio visível, novos pedidos bloqueados"}
          </p>
        </div>
        <button
          type="button"
          onClick={handleToggle}
          disabled={isPending}
          className={
            isActive
              ? "h-9 rounded-lg border border-red/30 px-4 text-sm font-bold text-red transition-all hover:bg-red/5 disabled:cursor-not-allowed disabled:opacity-50"
              : "h-9 rounded-lg bg-primary px-4 text-sm font-bold text-white transition-all hover:bg-[#ff5436] disabled:cursor-not-allowed disabled:opacity-50"
          }
        >
          {isPending ? "Atualizando..." : isActive ? "Pausar pedidos" : "Reabrir loja"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-[#FEF2F2] bg-[#FEF2F2] px-3 py-2 text-sm font-medium text-red">{error}</div>
      )}

      {unavailableProductCount > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[#FFFBEB] bg-[#FFFBEB] px-4 py-2.5 text-sm">
          <p className="font-medium text-[#B45309]">
            {unavailableProductCount} produto{unavailableProductCount > 1 ? "s" : ""} marcado
            {unavailableProductCount > 1 ? "s" : ""} como indisponíve{unavailableProductCount > 1 ? "is" : "l"} no cardápio
          </p>
          <Link href="/painel/produtos" className="shrink-0 font-bold text-[#B45309] hover:underline">
            Ajustar
          </Link>
        </div>
      )}
    </div>
  );
}
