"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { updateSubscriptionProviderAction } from "@/lib/actions/plans";

type Provider = "asaas" | "mercadopago";

const OPTIONS: { id: Provider; name: string; hint: string }[] = [
  { id: "asaas", name: "Asaas", hint: "Pix, boleto e cartão. O lojista recebe o link de pagamento por e-mail." },
  { id: "mercadopago", name: "Mercado Pago", hint: "Assinatura recorrente. O lojista paga no checkout do Mercado Pago." },
];

/**
 * Escolha do provedor de cobrança das NOVAS assinaturas (área "Assinaturas" do
 * Master). Assinaturas já existentes continuam no provedor em que nasceram. Só
 * entra em uso um provedor com credenciais configuradas; o servidor recusa o
 * resto e o banco impõe a escolha. Nenhuma credencial aparece aqui: só se está
 * configurada ou não (chaves ficam em variáveis de ambiente do servidor).
 */
export function BillingProviderCard({
  provider,
  asaasReady,
  mercadopagoReady,
  mercadopagoWebhookUrl,
}: {
  provider: Provider;
  asaasReady: boolean;
  mercadopagoReady: boolean;
  mercadopagoWebhookUrl: string;
}) {
  const [active, setActive] = useState<Provider>(provider);
  const [syncedProvider, setSyncedProvider] = useState<Provider>(provider);
  if (provider !== syncedProvider) {
    setSyncedProvider(provider);
    setActive(provider);
  }

  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const ready: Record<Provider, boolean> = { asaas: asaasReady, mercadopago: mercadopagoReady };

  function choose(next: Provider) {
    if (next === active || isPending) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateSubscriptionProviderAction(next);
      if (!result.ok) {
        setError(result.error ?? "Não foi possível alterar o provedor.");
        return;
      }
      setActive(next);
      setSaved(true);
    });
  }

  return (
    <Card className="p-5">
      <h2 className="text-body-md font-bold text-graphite">Provedor de cobrança</h2>
      <p className="mt-0.5 text-body-sm text-text-muted">
        Por onde as <strong>novas</strong> assinaturas são cobradas. Quem já assina continua no provedor em que começou.
      </p>

      <div role="radiogroup" aria-label="Provedor de cobrança" className="mt-4 grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((option) => {
          const selected = active === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={isPending}
              onClick={() => choose(option.id)}
              className={`flex flex-col items-start gap-1.5 rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                selected ? "border-primary bg-primary/5" : "border-border bg-surface-card hover:border-slate-300"
              }`}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="text-body-lg font-bold text-graphite">{option.name}</span>
                {selected && <Badge tone="success">Ativo</Badge>}
              </span>
              <span className="text-body-sm text-text-muted">{option.hint}</span>
              <Badge tone={ready[option.id] ? "success" : "warning"}>
                {ready[option.id] ? "Credenciais configuradas" : "Credenciais pendentes"}
              </Badge>
            </button>
          );
        })}
      </div>

      {error && <p className="mt-3 text-label-md text-red">{error}</p>}
      {saved && !error && <p className="mt-3 text-label-md text-emerald">Provedor atualizado.</p>}

      <div className="mt-4 rounded-xl border border-border bg-surface px-3.5 py-3 text-body-sm text-text-muted">
        <p className="font-semibold text-graphite">Mercado Pago — como configurar</p>
        <ol className="mt-1.5 list-decimal space-y-1 pl-4">
          <li>
            Defina no servidor as variáveis <code>MERCADOPAGO_ACCESS_TOKEN</code> (credencial do app) e{" "}
            <code>MERCADOPAGO_WEBHOOK_SECRET</code> (chave secreta do webhook). Nunca as coloque nesta tela.
          </li>
          <li>
            No painel do Mercado Pago (Suas integrações → Webhooks), use esta URL e ative os eventos de assinatura
            (<code>subscription_preapproval</code>) e de cobrança da assinatura (<code>subscription_authorized_payment</code>):
            <span className="mt-1 block break-all rounded-md bg-surface-card px-2 py-1 font-mono text-graphite">
              {mercadopagoWebhookUrl}
            </span>
          </li>
          <li>Teste primeiro com as credenciais de teste do Mercado Pago, antes de ativar para os lojistas.</li>
        </ol>
      </div>
    </Card>
  );
}
