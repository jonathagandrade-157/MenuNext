import { formatCurrencyBRL } from "@/lib/store";
import type { PublicCombo } from "@/lib/store";

function ImagePlaceholderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="9" r="1.5" />
      <path d="m21 15-5-5-9 9" />
    </svg>
  );
}

/** Card de combo: nome/descrição/preço próprios + composição (produtos existentes, nunca duplicados). */
export function StoreComboCard({ combo }: { combo: PublicCombo }) {
  const hasUnavailableProduct = combo.combo_items.some((item) => !item.product.is_available);

  return (
    <div className={`rounded-2xl border border-border bg-surface-card p-3.5 ${!combo.is_available ? "opacity-60" : ""}`}>
      <div className="flex gap-3">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-surface-subdued">
          {combo.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={combo.imageUrl} alt={combo.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-text-muted">
              <ImagePlaceholderIcon />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-graphite">{combo.name}</h3>
          {combo.description && <p className="mt-0.5 line-clamp-2 text-xs text-text-muted">{combo.description}</p>}
        </div>
      </div>

      <ul className="mt-3 space-y-0.5 border-t border-border pt-2.5 text-xs text-text-muted">
        {combo.combo_items.map((item) => (
          <li key={item.id}>
            {item.product.name} × {item.quantity}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-base font-extrabold text-graphite">{formatCurrencyBRL(combo.price)}</span>
        {!combo.is_available ? (
          <span className="rounded-full bg-red/10 px-2 py-0.5 text-[10px] font-bold text-red">Indisponível</span>
        ) : (
          hasUnavailableProduct && (
            <span className="rounded-full bg-amber/10 px-2 py-0.5 text-[10px] font-bold text-amber">
              ⚠️ Produto indisponível
            </span>
          )
        )}
      </div>
    </div>
  );
}
