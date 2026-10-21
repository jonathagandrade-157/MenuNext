"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button, LinkButton } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { CopyLinkButton } from "@/components/onboarding/CopyLinkButton";
import { ShareStoreModal } from "./ShareStoreModal";
import { generateStoreQrCodeDataUrl } from "@/lib/qrcode";
import { escapeHtml } from "@/lib/orderTicket";

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
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    generateStoreQrCodeDataUrl(storeUrl)
      .then((url) => {
        if (!cancelled) setQr(url);
      })
      .catch(() => {
        if (!cancelled) setQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [storeUrl]);

  function slugName() {
    return storeName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }

  function handleDownload() {
    if (!qr) return;
    const link = document.createElement("a");
    link.href = qr;
    link.download = `qrcode-${slugName()}.png`;
    link.click();
  }

  /** Cartaz para o balcão e as mesas: nome da loja, QR Code e link (texto sempre escapado). */
  function handlePrint() {
    if (!qr) return;
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>QR Code - ${escapeHtml(storeName)}</title>
<style>@page{margin:12mm}body{font-family:Arial,sans-serif;text-align:center;margin:0}h1{font-size:28px;margin:24px 0 4px}p{margin:4px 0;color:#333}img{width:320px;height:320px;margin:16px 0}.url{font-size:16px;word-break:break-all}</style></head>
<body><h1>${escapeHtml(storeName)}</h1><p>Aponte a câmera do celular e faça seu pedido</p><img src="${qr}" alt="QR Code da loja"><p class="url">${escapeHtml(storeUrl)}</p></body></html>`;
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    iframe.srcdoc = html;
    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => iframe.remove(), 1000);
    };
    document.body.appendChild(iframe);
  }

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-label-md uppercase tracking-wide text-text-muted">
            {hasAnyOrder ? "Sua loja" : "🎯 Receba seu primeiro pedido"}
          </p>
          <p className="mt-1 text-body-md text-text-muted">
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
        <p className="min-w-0 flex-1 truncate text-body-md font-medium text-graphite">{storeUrl}</p>
      </div>

      {qr && (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-border p-4 sm:flex-row">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL gerada no navegador */}
          <img src={qr} alt={`QR Code da loja ${storeName}`} className="h-28 w-28 shrink-0 rounded-lg" />
          <div className="text-center sm:text-left">
            <p className="text-body-md font-bold text-graphite">QR Code do balcão e das mesas</p>
            <p className="text-body-sm text-text-muted">
              O cliente aponta a câmera do celular e abre o seu cardápio, sem baixar nenhum aplicativo.
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-2 sm:justify-start">
              <Button type="button" size="sm" variant="secondary" onClick={handleDownload}>
                Baixar PNG
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={handlePrint}>
                Imprimir cartaz
              </Button>
            </div>
          </div>
        </div>
      )}

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
