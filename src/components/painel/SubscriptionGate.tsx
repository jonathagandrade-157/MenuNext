"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ACCESS_STATE_COPY, type AccessState } from "@/lib/accessState";

const PLANO_PATH = "/painel/plano";

/** Bloqueio total do painel quando o acesso está bloqueado — assinatura
 * atrasada/cancelada ou trial expirado sem plano (decisão tomada com o
 * usuário). Única exceção é /painel/plano, para o dono conseguir
 * regularizar; sem essa exceção o bloqueio viraria um beco sem saída. Só o
 * OWNER consegue assinar, então a equipe (STAFF) vê a orientação de falar
 * com o responsável, sem o link. Client Component só porque usePathname()
 * precisa rodar no navegador (o layout em si continua Server Component,
 * decidindo o estado a partir do banco). */
export function SubscriptionGate({
  accessState,
  isOwner,
  sidebarAndTopbar,
  children,
}: {
  accessState: AccessState | null;
  isOwner: boolean;
  sidebarAndTopbar: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  if (accessState !== null && pathname !== PLANO_PATH) {
    const copy = ACCESS_STATE_COPY[accessState];
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface px-6 text-center">
        <span className="rounded-full bg-red/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-red">
          {copy.badge}
        </span>
        <h1 className="text-xl font-black text-graphite">O acesso ao painel está bloqueado</h1>
        <p className="max-w-sm text-sm text-text-muted">
          {isOwner ? copy.message : "O acesso da loja está bloqueado. Fale com o responsável pela loja para regularizar."}
        </p>
        {isOwner && (
          <Link
            href={PLANO_PATH}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-bold text-white hover:bg-primary-container"
          >
            Ver planos e assinatura
          </Link>
        )}
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
