"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button, LinkButton } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { CopyLinkButton } from "@/components/onboarding/CopyLinkButton";
import { ShareStoreModal } from "./ShareStoreModal";

/**
 * "Sua loja" (Etapa 5) e "Receba seu primeiro pedido" (Etapa 9) num único
 * card — as duas etapas do prompt da Sprint pedem exatamente os mesmos 3
 * botões (Ver minha loja / Copiar link / Compartilhar); duplicá-los em dois
 * cards seria repetir a mesma ação duas vezes na mesma tela. O que muda é
 * só o título/mensagem, de acordo com `hasAnyOrder` (dado real — não é
 * gamificação, é o mesmo estado que decide o que mostrar).
 */
export function StoreShareCard({
  storeUrl,
  storeName,
  isActive,
  hasAnyOrder,
}: {
  storeUrl: string;
  storeName: string;
  isActive: boolean;
  hasAnyOrder: boolean;
}) {
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            {hasAnyOrder ? "Sua loja" : "🎯 Receba seu primeiro pedido"}
          </p>
          <p className="mt-1 text-sm text-text-muted">
            {hasAnyOrder
              ? "Continue compartilhando o link da sua loja para vender mais."
              : "Compartilhe o link da sua loja com seus clientes para começar a vender."}
          </p>
        </div>
        <Badge tone={isActive ? "success" : "neutral"} pulse={isActive}>
          {isActive ? "Loja ativa" : "Loja pausada"}
        </Badge>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-surface-subdued px-3 py-2.5">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-graphite">{storeUrl}</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2.5">
        <LinkButton href={storeUrl}>Ver minha loja</LinkButton>
        <CopyLinkButton url={storeUrl} />
        <Button type="button" variant="secondary" onClick={() => setShareOpen(true)}>
          Compartilhar
        </Button>
      </div>

      <ShareStoreModal open={shareOpen} onClose={() => setShareOpen(false)} storeUrl={storeUrl} storeName={storeName} />
    </Card>
  );
}
