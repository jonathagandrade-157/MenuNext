import Link from "next/link";
import { formatCurrencyBRL } from "@/lib/store";

function ImagePlaceholderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="9" r="1.5" />
      <path d="m21 15-5-5-9 9" />
    </svg>
  );
}

/** Card de produto do cardápio público. Produto indisponível fica visível,
 * mas claramente marcado — nunca representado como disponível para compra
 * (o fluxo de adicionar à sacola só chega numa fase futura). */
export function StoreProductCard({
  href,
  name,
  description,
  price,
  imageUrl,
  isAvailable,
}: {
  href: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  isAvailable: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex gap-3 rounded-2xl border border-border bg-surface-card p-3 transition-colors hover:bg-surface-subdued/60 ${!isAvailable ? "opacity-60" : ""}`}
    >
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-surface-subdued">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-text-muted">
            <ImagePlaceholderIcon />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div>
          <h3 className="text-sm font-bold text-graphite">{name}</h3>
          {description && <p className="mt-0.5 line-clamp-2 text-xs text-text-muted">{description}</p>}
        </div>
        <div className="flex items-center justify-between pt-1">
          <span className="text-sm font-extrabold text-graphite">{formatCurrencyBRL(price)}</span>
          {!isAvailable && (
            <span className="rounded-full bg-red/10 px-2 py-0.5 text-[10px] font-bold text-red">Indisponível</span>
          )}
        </div>
      </div>
    </Link>
  );
}
