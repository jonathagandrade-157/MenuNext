"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/**
 * Gaveta lateral (painel que desliza da direita) — usada para o detalhe de um
 * item sem tirar o lojista da tela (ex.: pedido aberto sobre o Kanban). Em
 * telas pequenas ocupa a largura toda. Fecha com Esc ou clicando fora; o foco
 * vai para a gaveta ao abrir e volta ao elemento anterior ao fechar.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  badge,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  /** Selo ao lado do título (ex.: status). */
  badge?: React.ReactNode;
  children: React.ReactNode;
  /** Rodapé fixo (ações). */
  footer?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Fechar" onClick={onClose} className="absolute inset-0 bg-graphite/40 backdrop-blur-[2px]" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-surface-card shadow-[var(--shadow-modal)] outline-none animate-[drawer-in_180ms_ease-out]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-headline-md text-graphite">{title}</h2>
              {badge}
            </div>
            {subtitle && <p className="mt-0.5 text-body-sm text-text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-subdued text-text-muted transition-colors hover:text-graphite"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="border-t border-border bg-surface-card px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}
