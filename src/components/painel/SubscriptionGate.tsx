"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PLANO_PATH = "/painel/plano";

/** Bloqueio total do painel quando a assinatura está overdue/cancelled
 * (decisão tomada com o usuário) — única exceção é /painel/plano, para o
 * dono conseguir regularizar o pagamento; sem essa exceção o bloqueio
 * viraria um beco sem saída. Client Component só porque usePathname()
 * precisa rodar no navegador (o layout em si continua Server Component,
 * decidindo "blocked" a partir do subscription_status real do banco). */
export function SubscriptionGate({
  blocked,
  sidebarAndTopbar,
  children,
}: {
  blocked: boolean;
  sidebarAndTopbar: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  if (blocked && pathname !== PLANO_PATH) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface px-6 text-center">
        <span className="rounded-full bg-red/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-red">
          Assinatura pendente
        </span>
        <h1 className="text-xl font-black text-graphite">O acesso ao painel está bloqueado</h1>
        <p className="max-w-sm text-sm text-text-muted">
          Há um pagamento em atraso ou sua assinatura foi cancelada. Regularize para voltar a usar o painel e a loja
          pública.
        </p>
        <Link
          href={PLANO_PATH}
          className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-bold text-white hover:bg-primary-container"
        >
          Ver minha assinatura
        </Link>
      </div>
    );
  }

  return (
    <>
      {sidebarAndTopbar}
      {children}
    </>
  );
}
