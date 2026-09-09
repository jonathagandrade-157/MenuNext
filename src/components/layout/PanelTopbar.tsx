import Link from "next/link";
import { Badge } from "@/components/ui/Badge";

export function PanelTopbar({
  storeName,
  storeSlug,
  isOpen = true,
}: {
  storeName: string;
  storeSlug?: string;
  isOpen?: boolean;
}) {
  return (
    <div className="flex h-16 items-center justify-between border-b border-border bg-surface-card px-6">
      <div>
        <p className="text-sm font-semibold text-graphite">{storeName}</p>
        <Badge tone={isOpen ? "success" : "neutral"} pulse={isOpen}>
          {isOpen ? "Loja Aberta" : "Loja Fechada"}
        </Badge>
      </div>
      {storeSlug && (
        <Link href={`/loja/${storeSlug}`} className="text-sm font-semibold text-primary hover:underline">
          Ver como cliente ↗
        </Link>
      )}
    </div>
  );
}
