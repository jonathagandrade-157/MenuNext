"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { CopyButton } from "./CopyButton";
import { refreshOrderPixAction } from "@/lib/actions/pixPublic";
import type { PublicPixCharge } from "@/lib/pixCharge";
import { formatCurrencyBRL } from "@/lib/store";

const POLL_MS = 5_000;
const POLL_MAX_MS = 35 * 60_000;

/**
 * Pix automático na página do pedido: QR dinâmico + copia e cola, e a confirmação aparece sozinha. A página
 * pergunta ao servidor a cada 5 s enquanto pendente; quem confirma é o servidor, consultando o Mercado Pago.
 */
export function PixChargePanel({
  slug,
  publicId,
  initial,
  qrDataUrl,
  fallbackPixKey,
}: {
  slug: string;
  publicId: string;
  initial: PublicPixCharge;
  qrDataUrl: string | null;
  fallbackPixKey: string | null;
}) {
  const [charge, setCharge] = useState(initial);

  useEffect(() => {
    if (charge.status !== "pending") return;
    const started = Date.now();
    let stopped = false;
    const timer = setInterval(async () => {
      if (stopped || Date.now() - started > POLL_MAX_MS || document.visibilityState === "hidden") return;
      const next = await refreshOrderPixAction(slug, publicId).catch(() => null);
      if (!stopped && next) setCharge(next);
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [charge.status, slug, publicId]);

  if (charge.status === "approved") {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-emerald/10 px-3 py-3 text-sm font-semibold text-emerald" role="status">
        <CheckCircle2 className="h-5 w-5" aria-hidden />
        Pagamento Pix de {formatCurrencyBRL(charge.amount)} confirmado.
      </div>
    );
  }

  if (charge.status !== "pending" || !charge.qrCode) {
    return (
      <div className="space-y-2 rounded-xl bg-surface-subdued px-3 py-3 text-sm text-text-muted" role="status">
        <p>O QR Code Pix deste pedido {charge.status === "expired" ? "expirou" : "não está mais válido"}. Fale com a loja para combinar o pagamento.</p>
        {fallbackPixKey && (
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-semibold text-graphite">{fallbackPixKey}</span>
            <CopyButton value={fallbackPixKey} label="Copiar chave" copiedLabel="Chave copiada!" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        Pague {formatCurrencyBRL(charge.amount)} com o QR Code ou o Pix copia e cola. A confirmação aparece aqui sozinha.
      </p>
      {qrDataUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qrDataUrl} alt="QR Code Pix do pedido" width={220} height={220} className="mx-auto rounded-xl border border-border" />
      )}
      <div className="flex items-center justify-between gap-2 rounded-xl bg-surface-subdued px-3 py-2">
        <span className="truncate font-mono text-xs text-graphite">{charge.qrCode}</span>
        <CopyButton value={charge.qrCode} label="Copiar código" copiedLabel="Código copiado!" />
      </div>
      <p className="flex items-center gap-2 text-xs text-text-muted" role="status" aria-live="polite">
        <span className="h-2 w-2 animate-pulse rounded-full bg-amber" aria-hidden />
        Aguardando pagamento…
      </p>
    </div>
  );
}
