import type { StoreOpenState } from "@/lib/store";
import { formatCurrencyBRL } from "@/lib/store";
import { StoreOpenBadge } from "./StoreOpenBadge";

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function StoreHeader({
  name,
  coverUrl,
  logoUrl,
  openState,
  serviceDelivery,
  deliveryFee,
  deliveryRadiusKm,
  estimatedDeliveryMinMinutes,
  estimatedDeliveryMaxMinutes,
}: {
  name: string;
  coverUrl: string | null;
  logoUrl: string | null;
  openState: StoreOpenState;
  serviceDelivery: boolean;
  deliveryFee: number | null;
  deliveryRadiusKm: number | null;
  estimatedDeliveryMinMinutes: number | null;
  estimatedDeliveryMaxMinutes: number | null;
}) {
  const hasEstimate = estimatedDeliveryMinMinutes !== null && estimatedDeliveryMaxMinutes !== null;

  return (
    <header className="relative">
      <div className="relative h-40 w-full overflow-hidden bg-graphite">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl} alt={`Capa de ${name}`} className="h-full w-full object-cover opacity-90" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-graphite to-[#1e293b]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
        <div className="absolute right-3 top-3">
          <StoreOpenBadge state={openState} />
        </div>
      </div>

      <div className="relative px-4 pb-4">
        <div className="-mt-10 flex items-end gap-3">
          <div className="h-20 w-20 shrink-0 rounded-2xl border-2 border-white bg-white p-1 shadow-lg">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={`Logo de ${name}`} className="h-full w-full rounded-xl object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[#ff5436] text-lg font-extrabold text-white">
                {getInitials(name)}
              </div>
            )}
          </div>
          <div className="pb-1">
            <h1 className="text-xl font-extrabold tracking-tight text-graphite">{name}</h1>
            <p className="text-xs font-medium text-text-muted">Cardápio digital</p>
          </div>
        </div>

        {serviceDelivery && (
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3">
            <div className="rounded-xl bg-surface-subdued p-2.5">
              <p className="text-[11px] font-medium text-text-muted">Taxa de entrega</p>
              <p className="text-xs font-bold text-graphite">
                {deliveryFee !== null ? formatCurrencyBRL(deliveryFee) : "A combinar"}
                {deliveryRadiusKm !== null && ` · até ${deliveryRadiusKm} km`}
              </p>
            </div>
            {hasEstimate && (
              <div className="rounded-xl bg-surface-subdued p-2.5">
                <p className="text-[11px] font-medium text-text-muted">Tempo estimado</p>
                <p className="text-xs font-bold text-graphite">
                  {estimatedDeliveryMinMinutes}–{estimatedDeliveryMaxMinutes} min
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
