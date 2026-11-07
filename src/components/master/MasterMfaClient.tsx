"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";

type Mode = { kind: "loading" } | { kind: "verify"; factorId: string } | { kind: "enroll"; factorId: string; qr: string; secret: string };

const INPUT = "h-12 w-full rounded-xl border border-border bg-surface-card px-3.5 text-center text-headline-sm tracking-[0.4em] text-graphite focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

/**
 * Segundo fator (TOTP) do administrador da plataforma. Primeira vez: cadastra o aplicativo autenticador (QR code) e
 * confirma com um código; depois: só pede o código de 6 dígitos. Tudo passa pelo Supabase Auth (MFA nativo); o app não
 * guarda segredo nenhum. Fatores não confirmados de tentativas antigas são removidos antes de um novo cadastro.
 */
export function MasterMfaClient() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (cancelled) return;
      if (listError) return setError("Não foi possível carregar o segundo fator. Tente novamente.");
      const verified = data.totp.find((f) => f.status === "verified");
      if (verified) return setMode({ kind: "verify", factorId: verified.id });
      for (const stale of data.all.filter((f) => f.factor_type === "totp" && f.status !== "verified")) {
        await supabase.auth.mfa.unenroll({ factorId: stale.id });
      }
      const enrolled = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "MenuNext Master" });
      if (cancelled) return;
      if (enrolled.error || !enrolled.data) return setError("Não foi possível iniciar o cadastro do autenticador.");
      setMode({ kind: "enroll", factorId: enrolled.data.id, qr: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function confirm() {
    if (mode.kind === "loading") return;
    if (!/^\d{6}$/.test(code)) return setError("Digite os 6 dígitos do aplicativo autenticador.");
    setBusy(true);
    setError(null);
    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({ factorId: mode.factorId, code });
    setBusy(false);
    if (verifyError) return setError("Código inválido ou expirado. Confira o horário do celular e tente de novo.");
    router.replace("/master");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4 py-10">
      <h1 className="text-headline-lg text-graphite">Verificação em duas etapas</h1>
      {mode.kind === "enroll" && (
        <div className="space-y-3">
          <p className="text-body-md text-text-muted">
            Escaneie o QR code com um aplicativo autenticador (Google Authenticator, Authy, 1Password…) e digite o código gerado.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- QR code em data URI vindo do Supabase Auth */}
          <img src={mode.qr} alt="QR code para o aplicativo autenticador" className="mx-auto h-48 w-48 rounded-xl bg-white p-2" />
          <p className="break-all text-center text-body-sm text-text-muted">Sem câmera? Código manual: <span className="font-mono">{mode.secret}</span></p>
        </div>
      )}
      {mode.kind === "verify" && <p className="text-body-md text-text-muted">Digite o código de 6 dígitos do seu aplicativo autenticador.</p>}
      {mode.kind === "loading" && !error && <p className="text-body-md text-text-muted">Carregando…</p>}
      {mode.kind !== "loading" && (
        <>
          <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} aria-label="Código de 6 dígitos" className={INPUT} />
          <Button onClick={() => void confirm()} loading={busy} disabled={busy || code.length !== 6}>Confirmar</Button>
        </>
      )}
      {error && <ErrorState message={error} />}
    </main>
  );
}
