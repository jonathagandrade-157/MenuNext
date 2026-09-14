"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/loja/CopyButton";
import { generateStoreQrCodeDataUrl } from "@/lib/qrcode";

/**
 * Modal "Compartilhe sua loja" (Sprint 4, Etapas 6-7) — sem backend novo: o
 * QR Code é gerado no navegador a partir da própria storeUrl (já resolvida
 * no servidor a partir do host real da requisição, ver src/lib/site-url.ts)
 * e nunca persistido. Web Share API é usada quando disponível
 * (navigator.share); no fallback (a maioria dos desktops), o lojista ainda
 * tem copiar link, WhatsApp e QR Code — nunca fica sem opção.
 */
export function ShareStoreModal({
  open,
  onClose,
  storeUrl,
  storeName,
}: {
  open: boolean;
  onClose: () => void;
  storeUrl: string;
  storeName: string;
}) {
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [qrCodeFailed, setQrCodeFailed] = useState(false);
  const [canUseWebShare, setCanUseWebShare] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCanUseWebShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQrCodeFailed(false);
    generateStoreQrCodeDataUrl(storeUrl)
      .then((dataUrl) => {
        if (!cancelled) setQrCodeDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrCodeFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, storeUrl]);

  async function handleWebShare() {
    try {
      await navigator.share({ title: storeName, text: `Peça agora no ${storeName}!`, url: storeUrl });
    } catch {
      // Usuário cancelou o share nativo ou o navegador recusou — não é erro
      // do produto, nada para mostrar.
    }
  }

  function handleDownloadQrCode() {
    if (!qrCodeDataUrl) return;
    const link = document.createElement("a");
    link.href = qrCodeDataUrl;
    link.download = `qrcode-${storeName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
    link.click();
  }

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(`Peça agora no ${storeName}! ${storeUrl}`)}`;

  return (
    <Modal open={open} onClose={onClose} title="Compartilhe sua loja">
      <div className="space-y-5">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-subdued px-3 py-2.5">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-graphite">{storeUrl}</p>
          <CopyButton value={storeUrl} />
        </div>

        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface-subdued p-5">
          {qrCodeFailed ? (
            <p className="py-8 text-center text-xs text-text-muted">Não foi possível gerar o QR Code agora.</p>
          ) : qrCodeDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URL local, sem otimização de imagem remota a fazer
            <img src={qrCodeDataUrl} alt={`QR Code para abrir ${storeName}`} className="h-40 w-40 rounded-lg" />
          ) : (
            <div className="h-40 w-40 animate-pulse rounded-lg bg-surface-card" />
          )}
          <p className="text-center text-xs font-semibold text-text-muted">Escaneie para abrir sua loja</p>
          <Button type="button" variant="secondary" size="sm" onClick={handleDownloadQrCode} disabled={!qrCodeDataUrl}>
            Baixar QR Code
          </Button>
        </div>

        <div className="flex flex-wrap gap-2.5">
          {canUseWebShare && (
            <Button type="button" onClick={handleWebShare} className="flex-1">
              Compartilhar
            </Button>
          )}
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald px-5 text-sm font-semibold text-white transition-all hover:opacity-90"
          >
            Compartilhar no WhatsApp
          </a>
        </div>
      </div>
    </Modal>
  );
}
