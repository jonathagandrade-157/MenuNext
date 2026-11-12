"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { deletePixTokenAction, savePixTokenAction, savePixWebhookSecretAction, setPixAutoEnabledAction } from "@/lib/actions/pixSettings";
import type { PixSettingsStatus } from "@/lib/pixCharge";

/**
 * Pix automático (Mercado Pago da própria loja). O token é digitado aqui, vai para a Server Action, é cifrado no
 * servidor e nunca volta: a tela só mostra os 4 últimos caracteres. Token novo sempre nasce desligado.
 */
export function PixAutoCard({ status }: { status: PixSettingsStatus }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, okText: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setToken("");
        setWebhookSecret("");
        setMessage({ kind: "ok", text: okText });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: result.error });
      }
    });
  }

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-headline-sm text-graphite">Pix automático (Mercado Pago)</h2>
        <p className="mt-1 text-body-md text-text-muted">
          Cada pedido com Pix ganha um QR Code com o valor exato, e o pagamento é confirmado sozinho. O dinheiro cai
          direto na <strong>sua</strong> conta Mercado Pago (as tarifas são as do Mercado Pago).
        </p>
      </div>

      {!status.available ? (
        <p className="text-body-md text-text-muted">Indisponível neste ambiente.</p>
      ) : (
        <>
          <div className="rounded-xl bg-surface p-3 text-body-md">
            {status.configured ? (
              <p>
                Token salvo: <span className="font-mono">••••{status.tokenHint}</span> ·{" "}
                <strong className={status.enabled ? "text-emerald" : "text-text-muted"}>{status.enabled ? "Ligado" : "Desligado"}</strong>
              </p>
            ) : (
              <p className="text-text-muted">Nenhum token salvo. Sem ele, o Pix continua pela sua chave Pix (confirmação manual).</p>
            )}
          </div>

          <label className="block space-y-1">
            <span className="text-label-md text-graphite">{status.configured ? "Trocar Access Token" : "Access Token de produção"}</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="APP_USR-..."
              className="h-10 w-full rounded-xl border border-border bg-surface px-3 font-mono text-body-md text-graphite focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
            />
            <span className="block text-body-sm text-text-muted">
              Mercado Pago → Suas integrações → sua aplicação → Credenciais de produção. Ao trocar, o recurso fica desligado até você ligar de novo.
            </span>
          </label>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => run(() => savePixTokenAction(token), "Token salvo. Confira e ligue o Pix automático.")} disabled={pending || !token.trim()} loading={pending}>
              Salvar token
            </Button>
            {status.configured && (
              <Button
                variant="secondary"
                onClick={() => run(() => setPixAutoEnabledAction(!status.enabled), status.enabled ? "Pix automático desligado." : "Pix automático ligado.")}
                disabled={pending}
              >
                {status.enabled ? "Desligar" : "Ligar Pix automático"}
              </Button>
            )}
            {status.configured && (
              <Button variant="ghost" onClick={() => run(() => deletePixTokenAction(), "Token removido.")} disabled={pending}>
                Remover token
              </Button>
            )}
          </div>

          {status.configured && (
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-body-md text-graphite">
                <strong>Assinatura secreta de webhooks</strong> (recomendado) ·{" "}
                <span className={status.webhookSecretConfigured ? "text-emerald" : "text-text-muted"}>
                  {status.webhookSecretConfigured ? "configurada" : "não configurada"}
                </span>
              </p>
              <p className="text-body-sm text-text-muted">
                Mercado Pago → sua aplicação → Webhooks → Configurar notificações: cadastre a URL de avisos do MenuNext,
                marque o evento <em>Pagamentos</em> e cole aqui a assinatura secreta exibida. Com ela, avisos falsos são
                recusados. Sem ela o pagamento continua sendo conferido direto no Mercado Pago antes de valer.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  aria-label="Assinatura secreta de webhooks"
                  className="h-10 w-full rounded-xl border border-border bg-surface px-3 font-mono text-body-md text-graphite focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
                />
                <Button
                  variant="secondary"
                  onClick={() => run(() => savePixWebhookSecretAction(webhookSecret), "Assinatura secreta salva.")}
                  disabled={pending || !webhookSecret.trim()}
                >
                  Salvar assinatura
                </Button>
                {status.webhookSecretConfigured && (
                  <Button variant="ghost" onClick={() => run(() => savePixWebhookSecretAction(""), "Assinatura secreta removida.")} disabled={pending}>
                    Remover
                  </Button>
                )}
              </div>
            </div>
          )}

          {message && (
            <p className={`text-body-sm font-semibold ${message.kind === "ok" ? "text-emerald" : "text-red"}`} role="status">
              {message.text}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
