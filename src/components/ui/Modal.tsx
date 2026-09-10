"use client";

import { useEffect } from "react";

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-graphite/40"
      />
      <div className="relative w-full max-w-md rounded-xl border border-border bg-surface-card p-6 shadow-[var(--shadow-modal)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-graphite">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-1 text-text-muted hover:bg-surface-subdued hover:text-graphite"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
