"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { toggleRestaurantStatusAction } from "@/lib/actions/configuracoes";

/**
 * Toggle de pausar/reabrir a loja (JON-24) — mesmo padrão de estado local +
 * chamada direta da action (sem useActionState) usado por
 * toggleProductAvailableAction/ProdutosClient: a UI já sabe o resultado
 * (ok/erro) sem depender do timing do refresh automático do Next após a
 * Server Action.
 */
export function StoreStatusCard({ initialStatus }: { initialStatus: "active" | "paused" }) {
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
    <Card className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-text-muted">Status da loja</h2>
          <p className="mt-1 text-sm text-text-muted">
            {isActive
              ? "Sua loja está aberta e recebendo novos pedidos normalmente."
              : "Sua loja está pausada — o cardápio continua visível para os clientes, mas o checkout fica bloqueado para novos pedidos até você reabrir."}
          </p>
        </div>
        <Badge tone={isActive ? "success" : "neutral"} pulse={isActive}>
          {isActive ? "Loja Aberta" : "Loja Pausada"}
        </Badge>
      </div>

      {error && (
        <div className="rounded-lg border border-[#FEF2F2] bg-[#FEF2F2] px-3 py-2 text-sm font-medium text-red">{error}</div>
      )}

      <button
        type="button"
        onClick={handleToggle}
        disabled={isPending}
        className={
          isActive
            ? "h-11 rounded-xl border border-red/30 px-5 text-sm font-bold text-red transition-all hover:bg-red/5 disabled:cursor-not-allowed disabled:opacity-50"
            : "h-11 rounded-xl bg-primary px-5 text-sm font-bold text-white transition-all hover:bg-[#ff5436] disabled:cursor-not-allowed disabled:opacity-50"
        }
      >
        {isPending ? "Atualizando..." : isActive ? "Pausar loja" : "Reabrir loja"}
      </button>
    </Card>
  );
}
