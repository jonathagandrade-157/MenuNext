"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/States";
import { setRequireAal2Action } from "@/lib/actions/master";

/**
 * Exigência de segundo fator no BANCO. Ligada, até uma chamada direta à API do Supabase com a sessão de um administrador
 * sem verificação em duas etapas é recusada. Só liga quem já está em duas etapas nesta sessão (anti-trancamento).
 * Perdeu o autenticador? Quem tem acesso de dono ao banco desliga com: update public.platform_security set require_aal2 = false;
 */
export function RequireAal2Card({ enabled }: { enabled: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    setError(null);
    startTransition(async () => {
      const result = await setRequireAal2Action(!enabled);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <Card className="space-y-3 p-5">
      <div>
        <h2 className="text-headline-sm text-graphite">Segundo fator exigido pelo banco</h2>
        <p className="mt-0.5 text-body-md text-text-muted">
          Estado: <strong className={enabled ? "text-emerald" : "text-amber-strong"}>{enabled ? "LIGADO" : "desligado"}</strong>. Ligado, nenhuma
          função administrativa responde a uma sessão sem verificação em duas etapas, nem por chamada direta à API.
        </p>
      </div>
      <p className="text-body-sm text-text-muted">
        Antes de ligar, confirme que o seu autenticador funciona em <Link href="/master-mfa" className="font-semibold text-primary hover:underline">/master-mfa</Link>{" "}
        e que você tem o procedimento de recuperação (acesso de dono ao banco). Só quem está em duas etapas nesta sessão consegue alterar.
      </p>
      {error && <ErrorState message={error} />}
      <Button variant={enabled ? "secondary" : "primary"} onClick={toggle} loading={pending} disabled={pending}>
        {enabled ? "Desligar exigência" : "Ligar exigência"}
      </Button>
    </Card>
  );
}
