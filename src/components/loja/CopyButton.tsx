"use client";

import { useState } from "react";

/** Botão genérico de copiar-para-área-de-transferência — usado na
 * confirmação do pedido para a chave Pix (não é a mesma coisa que
 * CopyLinkButton, que é específico do link de compartilhamento do
 * onboarding). */
export function CopyButton({ value, label = "Copiar", copiedLabel = "Copiado!" }: { value: string; label?: string; copiedLabel?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="shrink-0 rounded-lg border border-border bg-surface-card px-3 py-1.5 text-xs font-bold text-primary hover:bg-surface-subdued"
    >
      {copied ? `✓ ${copiedLabel}` : label}
    </button>
  );
}
