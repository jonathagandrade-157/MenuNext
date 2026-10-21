import { Bike, Clock, ShoppingBag, Store, Wallet } from "lucide-react";
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
  bio,
  coverUrl,
  logoUrl,
  openState,
  serviceDelivery,
  deliveryFee,
  deliveryRadiusKm,
  estimatedDeliveryMinMinutes,
  estimatedDeliveryMaxMinutes,
  servicePickup,
  minimumOrderValue,
}: {
  name: string;
  bio: string | null;
  coverUrl: string | null;
  logoUrl: string | null;
  openState: StoreOpenState;
  serviceDelivery: boolean;
  deliveryFee: number | null;
  deliveryRadiusKm: number | null;
  estimatedDeliveryMinMinutes: number | null;
  estimatedDeliveryMaxMinutes: number | null;
  servicePickup: boolean;
  minimumOrderValue: number | null;
}) {
  const hasEstimate = estimatedDeliveryMinMinutes !== null && estimatedDeliveryMaxMinutes !== null;

  // Só informações que a loja de fato configurou — nada de valor inventado.
  const info: { label: string; value: string; icon: typeof Clock; tint: string }[] = [];
  if (hasEstimate) {
    info.push({ label: "Tempo estimado", value: `${estimatedDeliveryMinMinutes}–${estimatedDeliveryMaxMinutes} min`, icon: Clock, tint: "bg-primary/10 text-primary" });
  }
  if (serviceDelivery) {
    info.push({
      label: "Taxa de entrega",
      value: `${deliveryFee !== null ? formatCurrencyBRL(deliveryFee) : "A combinar"}${deliveryRadiusKm !== null ? ` · até ${deliveryRadiusKm} km` : ""}`,
      icon: Bike,
      tint: "bg-emerald/10 text-emerald",
    });
  }
  if (minimumOrderValue !== null && minimumOrderValue > 0) {
    info.push({ label: "Pedido mínimo", value: formatCurrencyBRL(minimumOrderValue), icon: Wallet, tint: "bg-blue/10 text-blue" });
  }
  const modes = [serviceDelivery && "Delivery", servicePickup && "Retirada"].filter(Boolean).join(" • ");
  if (modes) {
    info.push({ label: "Modalidade", value: modes, icon: serviceDelivery ? ShoppingBag : Store, tint: "bg-amber/10 text-amber" });
  }

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
              <div className="flex h-full w-full items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-container text-lg font-extrabold text-white">
                {getInitials(name)}
              </div>
            )}
          </div>
          <div className="pb-1">
            <h1 className="text-headline-md text-graphite">{name}</h1>
            <p className="text-body-sm text-text-muted">{bio || "Cardápio digital"}</p>
          </div>
        </div>

        {info.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3">
            {info.map(({ label, value, icon: Icon, tint }) => (
              <div key={label} className="flex items-center gap-2.5 rounded-xl border border-border bg-surface p-2.5">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tint}`}>
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-label-sm text-text-muted">{label}</p>
                  <p className="text-label-md text-graphite">{value}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
