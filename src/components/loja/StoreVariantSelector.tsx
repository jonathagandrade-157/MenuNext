import { formatCurrencyBRL } from "@/lib/store";
import type { PublicVariant } from "@/lib/storeVariants";

/**
 * Escolha da variante (tamanho/versão) — escolha única e obrigatória quando o produto tem variantes.
 * Variante desligada aparece marcada como indisponível e não pode ser escolhida. Usado na loja e no PDV.
 */
export function StoreVariantSelector({
  productId,
  variants,
  selectedId,
  onChange,
  label = "Escolha uma opção",
}: {
  productId: string;
  variants: PublicVariant[];
  selectedId: string | null;
  onChange: (id: string) => void;
  label?: string;
}) {
  if (variants.length === 0) return null;
  return (
    <fieldset className="space-y-2 border-b border-border pb-4">
      <div className="flex items-baseline justify-between gap-2">
        <legend className="text-sm font-bold text-graphite">{label}</legend>
        <span className="text-[11px] font-semibold text-text-muted">Obrigatório · escolha 1</span>
      </div>
      <div className="space-y-1.5">
        {variants.map((variant) => {
          const checked = selectedId === variant.id;
          const disabled = !variant.isAvailable;
          return (
            <label
              key={variant.id}
              className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm ${
                checked ? "border-primary bg-primary/5" : "border-border"
              } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
            >
              <span className="flex items-center gap-2.5">
                <input
                  type="radio"
                  name={`variant-${productId}`}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onChange(variant.id)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="font-medium text-graphite">{variant.name}</span>
                {disabled && <span className="text-[11px] font-semibold text-red">Indisponível</span>}
              </span>
              <span className="shrink-0 text-xs font-bold text-text-muted">{formatCurrencyBRL(variant.price)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
