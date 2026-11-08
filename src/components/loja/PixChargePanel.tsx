"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { CopyButton } from "./CopyButton";
import { refreshOrderPixAction } from "@/lib/actions/pixPublic";
import type { PublicPixCharge } from "@/lib/pixCharge";
import { formatCurrencyBRL } from "@/lib/store";

const POLL_MS = 5_000;
const POLL_MAX_MS = 35 * 60_000;

/**
 * Pix automático na página do pedido. Regra para nunca cobrar duas vezes:
 *   - gerando: só "gerando QR Code…", SEM a chave Pix comum (a cobrança pode existir no Mercado Pago);
 *   - pendente: só o QR dinâmico e o copia e cola;
 *   - pago: confirmação;
 *   - falhou/expirou/cancelada: nenhum QR automático válido — chave Pix comum, avisando que a loja confere
 *     esse pagamento manualmente.
 * A página pergunta ao servidor a cada 5 s; quem confirma é o servidor, consultando o Mercado Pago.
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
  const [qr, setQr] = useState(qrDataUrl);

  useEffect(() => {
    if (charge.status !== "pending" && charge.status !== "creating") return;
    const started = Date.now();
    let stopped = false;
    const timer = setInterval(async () => {
      if (stopped || Date.now() - started > POLL_MAX_MS || document.visibilityState === "hidden") return;
      const next = await refreshOrderPixAction(slug, publicId).catch(() => null);
      if (stopped || !next) return;
      if (charge.status === "creating" && next.status === "pending" && next.qrCode) {
        const { toDataURL } = await import("qrcode");
        setQr(await toDataURL(next.qrCode, { margin: 1, width: 280, color: { dark: "#121826", light: "#ffffff" } }).catch(() => null));
      }
      setCharge(next);
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

  if (charge.status === "creating") {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-surface-subdued px-3 py-3 text-sm text-text-muted" role="status" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Gerando o QR Code Pix do pedido… Aguarde antes de pagar.
      </p>
    );
  }

  if (charge.status !== "pending" || !charge.qrCode) {
    return (
      <div className="space-y-2 rounded-xl bg-surface-subdued px-3 py-3 text-sm text-text-muted" role="status">
        <p>
          {charge.status === "expired" ? "O QR Code Pix deste pedido expirou." : "O Pix automático não está disponível para este pedido."}{" "}
          {fallbackPixKey
            ? "Você pode pagar pela chave Pix da loja abaixo; a loja confere esse pagamento manualmente."
            : "Fale com a loja para combinar o pagamento."}
        </p>
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
      {qr && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt="QR Code Pix do pedido" width={220} height={220} className="mx-auto rounded-xl border border-border" />
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
