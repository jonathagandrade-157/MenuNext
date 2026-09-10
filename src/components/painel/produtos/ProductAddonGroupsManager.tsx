"use client";

import { useMemo, useState, useTransition } from "react";
import { ErrorState } from "@/components/ui/States";
import { addProductAddonGroupAction, removeProductAddonGroupAction } from "@/lib/actions/addons";
import type { AddonGroup, ProductAddonGroupWithGroup } from "@/lib/tenant";

/**
 * Seção "Adicionais" do editor de produto — mostra os grupos já associados
 * (como chips removíveis) e um seletor restrito aos grupos do PRÓPRIO
 * restaurante para associar mais. Gerenciamento de itens dentro do grupo
 * continua exclusivo de /painel/adicionais (fora do escopo desta seção).
 */
export function ProductAddonGroupsManager({
  productId,
  restaurantAddonGroups,
  associations,
}: {
  productId: string;
  restaurantAddonGroups: AddonGroup[];
  associations: ProductAddonGroupWithGroup[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [selectedGroupId, setSelectedGroupId] = useState("");

  const sortedAssociations = useMemo(
    () => [...associations].sort((a, b) => a.display_order - b.display_order),
    [associations]
  );

  const availableGroups = useMemo(() => {
    const associatedIds = new Set(associations.map((a) => a.addon_group_id));
    return [...restaurantAddonGroups]
      .filter((group) => !associatedIds.has(group.id))
      .sort((a, b) => a.display_order - b.display_order);
  }, [restaurantAddonGroups, associations]);

  function handleAdd() {
    if (!selectedGroupId) return;
    setError(null);
    setPendingId("new");
    startTransition(async () => {
      const result = await addProductAddonGroupAction(productId, selectedGroupId);
      setPendingId(null);
      if (!result.ok) {
        setError(result.error ?? "Não foi possível associar o grupo.");
        return;
      }
      setSelectedGroupId("");
    });
  }

  function handleRemove(associationId: string) {
    setError(null);
    setPendingId(associationId);
    startTransition(async () => {
      const result = await removeProductAddonGroupAction(associationId);
      setPendingId(null);
      if (!result.ok) setError(result.error ?? "Não foi possível remover o grupo.");
    });
  }

  return (
    <div className="space-y-3">
      <span className="block text-sm font-semibold text-graphite">Adicionais</span>

      {sortedAssociations.length === 0 ? (
        <p className="text-xs text-text-muted">Nenhum grupo de adicionais associado a este produto.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {sortedAssociations.map((association) => {
            const busy = isPending && pendingId === association.id;
            return (
              <span
                key={association.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-subdued px-3 py-1 text-xs font-semibold text-graphite"
              >
                {association.addon_group.name}
                <button
                  type="button"
                  title="Remover grupo"
                  disabled={busy}
                  onClick={() => handleRemove(association.id)}
                  className="text-text-muted hover:text-red disabled:cursor-not-allowed disabled:opacity-50"
                >
                  ✕
                </button>
              </span>
            );
          })}
        </div>
      )}

      {availableGroups.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            className="h-9 flex-1 rounded-lg border border-border bg-surface px-2.5 text-xs font-semibold text-graphite focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
          >
            <option value="">Selecione um grupo...</option>
            {availableGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!selectedGroupId || isPending}
            onClick={handleAdd}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-border px-3 text-xs font-semibold text-graphite hover:bg-surface-subdued disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="text-sm leading-none">+</span>
            Adicionar grupo
          </button>
        </div>
      )}

      {error && <ErrorState message={error} />}
    </div>
  );
}
