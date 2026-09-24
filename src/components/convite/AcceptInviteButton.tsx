"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import { acceptInviteAction } from "@/lib/actions/invites";

export function AcceptInviteButton({ token, restaurantName }: { token: string; restaurantName: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAccept() {
    setError(null);
    startTransition(async () => {
      const result = await acceptInviteAction(token);
      if (!result.ok) {
        setError(result.error ?? "Não foi possível aceitar o convite.");
        return;
      }
      router.push("/painel");
    });
  }

  return (
    <div className="space-y-4">
      {error && <ErrorState message={error} />}
      <Button onClick={handleAccept} loading={isPending} disabled={isPending} className="w-full">
        {isPending ? "Entrando..." : `Entrar na equipe de ${restaurantName}`}
      </Button>
    </div>
  );
}
