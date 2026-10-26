import Link from "next/link";
import type { ReactNode } from "react";

/** Moldura das telas de recuperação de senha: a mesma identidade do login, só que simples (um cartão no centro). */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface p-6">
      <Link href="/" className="mb-6 text-headline-sm font-extrabold text-graphite">
        Menu<span className="text-primary">Next</span>
      </Link>
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface-card p-8 shadow-[var(--shadow-modal)]">
        {children}
      </div>
    </main>
  );
}
