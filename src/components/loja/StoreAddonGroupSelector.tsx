import { describeAddonGroupRules } from "@/lib/addons";
import { formatCurrencyBRL } from "@/lib/store";
import type { AddonGroupWithAddons } from "@/lib/tenant";

/**
 * Seletor de UM grupo de adicionais no detalhe do produto. Grupos com
 * max_selections = 1 viram rádio (escolha única); os demais viram
 * checkboxes, desabilitando as opções não marcadas assim que o máximo é
 * atingido — nunca deixa passar de max no próprio clique.
 */
export function StoreAddonGroupSelector({
  group,
  selectedIds,
  onChange,
  error,
}: {
  group: AddonGroupWithAddons;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  error?: string | null;
}) {
  const isSingleChoice = group.max_selections === 1;
  const atMax = selectedIds.length >= group.max_selections;

  function toggle(addonId: string) {
    if (isSingleChoice) {
      onChange(selectedIds[0] === addonId ? [] : [addonId]);
      return;
    }
    if (selectedIds.includes(addonId)) {
      onChange(selectedIds.filter((id) => id !== addonId));
    } else if (!atMax) {
      onChange([...selectedIds, addonId]);
    }
  }

  return (
    <fieldset className="space-y-2 border-b border-border pb-4">
      <div className="flex items-baseline justify-between gap-2">
        <legend className="text-sm font-bold text-graphite">{group.name}</legend>
        <span className="text-[11px] font-semibold text-text-muted">{describeAddonGroupRules(group)}</span>
      </div>
      {group.description && <p className="text-xs text-text-muted">{group.description}</p>}

      <div className="space-y-1.5">
        {group.addons.map((addon) => {
          const checked = selectedIds.includes(addon.id);
          const disabled = !checked && !isSingleChoice && atMax;
          return (
            <label
              key={addon.id}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm ${
                checked ? "border-primary bg-primary/5" : "border-border"
              } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
            >
              <span className="flex items-center gap-2.5">
                <input
                  type={isSingleChoice ? "radio" : "checkbox"}
                  name={`group-${group.id}`}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(addon.id)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="font-medium text-graphite">{addon.name}</span>
              </span>
              <span className="shrink-0 text-xs font-bold text-text-muted">
                {addon.price > 0 ? `+ ${formatCurrencyBRL(addon.price)}` : "Grátis"}
              </span>
            </label>
          );
        })}
      </div>

      {error && <p className="text-xs font-semibold text-red">{error}</p>}
    </fieldset>
  );
}
