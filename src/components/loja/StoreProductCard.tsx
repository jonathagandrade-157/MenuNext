import Link from "next/link";
import { ImageIcon, Plus } from "lucide-react";
import { formatCurrencyBRL } from "@/lib/store";

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
      className={`flex gap-3 rounded-2xl border border-border bg-surface-card p-3 shadow-card transition-all hover:shadow-md ${!isAvailable ? "opacity-60" : ""}`}
    >
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-surface-subdued">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-text-muted">
            <ImageIcon className="h-6 w-6" aria-hidden />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div>
          <h3 className="text-body-md font-bold text-graphite">{name}</h3>
          {description && <p className="mt-0.5 line-clamp-2 text-body-sm text-text-muted">{description}</p>}
        </div>
        <div className="flex items-center justify-between pt-1">
          <span className="text-body-md font-bold text-graphite">{formatCurrencyBRL(price)}</span>
          {isAvailable ? (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white" aria-hidden>
              <Plus className="h-4 w-4" />
            </span>
          ) : (
            <span className="rounded-full bg-red/10 px-2 py-0.5 text-label-sm text-red">Indisponível</span>
          )}
        </div>
      </div>
    </Link>
  );
}
