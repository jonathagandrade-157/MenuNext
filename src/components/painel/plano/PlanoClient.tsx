"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/States";
import { ACCESS_STATE_COPY, type AccessState } from "@/lib/accessState";
import { subscribeToPlanAction } from "@/lib/actions/subscription";
import { getPendingPaymentLinkAction } from "@/lib/actions/pendingPayment";
import { formatCurrencyBRL } from "@/lib/products";
import type { Plan, Restaurant } from "@/lib/tenant";

const STATUS_LABEL: Record<Restaurant["subscription_status"], { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  active: { label: "Em dia", tone: "success" },
  pending: { label: "Aguardando primeiro pagamento", tone: "warning" },
  overdue: { label: "Pagamento atrasado", tone: "danger" },
  cancelled: { label: "Cancelada", tone: "neutral" },
};

export function PlanoClient({
  plans,
  currentPlan,
  subscriptionStatus,
  accessState,
  billingConfigured,
  provider,
}: {
  plans: Plan[];
  currentPlan: Plan | null;
  subscriptionStatus: Restaurant["subscription_status"];
  accessState: AccessState | null;
  billingConfigured: boolean;
  /** Provedor ativo escolhido pelo Master. */
  provider: "asaas" | "mercadopago";
}) {
  const [subscribingId, setSubscribingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // O link de pagamento chega validado do servidor (HTTPS de domínio do Mercado Pago).
  function goToPayment(url: string) {
    window.location.assign(url);
  }

  function handleResumePayment() {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const result = await getPendingPaymentLinkAction();
      if (result.status === "link") return goToPayment(result.url);
      if (result.status === "info") return setInfo(result.message);
      setError(result.message);
    });
  }

  function handleSubscribe(planId: string) {
    setError(null);
    setInfo(null);
    setSuccess(false);
    setSubscribingId(planId);
    startTransition(async () => {
      const result = await subscribeToPlanAction(planId);
      setSubscribingId(null);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      if (result.redirectUrl) return goToPayment(result.redirectUrl);
      setSuccess(true);
    });
  }

  // Trial expirado não aparece em subscription_status (continua "active" sem
  // plano), então o selo vem do estado de acesso.
  const status =
    accessState === "trial_expired"
      ? { label: ACCESS_STATE_COPY.trial_expired.badge, tone: "danger" as const }
      : STATUS_LABEL[subscriptionStatus];
  const hasLiveSubscription = currentPlan !== null && subscriptionStatus !== "cancelled";

  return (
    <div className="space-y-6">
      <Card className="flex items-center justify-between gap-3 p-5">
        <div>
          <p className="text-xs font-medium text-text-muted">Plano atual</p>
          <p className="mt-1 text-headline-sm text-graphite">{currentPlan ? currentPlan.name : "Nenhum plano assinado"}</p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </Card>

      {accessState !== null && (
        <div className="rounded-xl border border-red/20 bg-red/10 px-3.5 py-2.5 text-sm font-semibold text-red">
          {ACCESS_STATE_COPY[accessState].message}
        </div>
      )}

      {!billingConfigured && (
        <div className="rounded-xl border border-amber/20 bg-amber/10 px-3.5 py-2.5 text-xs font-medium text-amber">
          A cobrança de assinaturas ainda não foi configurada pela plataforma. Tente novamente mais tarde.
        </div>
      )}

      {hasLiveSubscription && (
        <div className="rounded-xl border border-border bg-surface px-3.5 py-2.5 text-xs font-medium text-text-muted">
          {subscriptionStatus === "active"
            ? "Sua assinatura está em dia. Para trocar de plano, fale com o suporte."
            : provider === "mercadopago"
              ? "Finalize o pagamento no Mercado Pago. Assim que for confirmado, o acesso é liberado."
              : "Finalize o pagamento pelo link que o Asaas enviou ao seu e-mail. Assim que for confirmado, o acesso é liberado."}
          {subscriptionStatus === "pending" && provider === "mercadopago" && (
            <button
              type="button"
              disabled={isPending}
              onClick={handleResumePayment}
              className="mt-2 inline-flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-bold text-white transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continuar pagamento no Mercado Pago
            </button>
          )}
        </div>
      )}

      {info && (
        <div className="rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm font-medium text-graphite">{info}</div>
      )}

      {success && (
        <div className="rounded-xl border border-emerald/30 bg-emerald/10 px-3.5 py-2.5 text-sm font-semibold text-emerald">
          Assinatura criada! Finalize o primeiro pagamento no link que o provedor de cobrança vai te enviar por e-mail.
        </div>
      )}
      {error && <ErrorState message={error} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => {
          const isCurrent = currentPlan?.id === plan.id;
          return (
            <Card key={plan.id} className="flex flex-col gap-3 p-5">
              <div>
                <h3 className="text-body-lg font-bold text-graphite">{plan.name}</h3>
                {plan.description && <p className="mt-1 text-xs text-text-muted">{plan.description}</p>}
              </div>
              <p className="text-headline-lg text-graphite">
                {formatCurrencyBRL(plan.price)}
                <span className="text-sm font-medium text-text-muted">/mês</span>
              </p>
              <button
                type="button"
                disabled={isCurrent || isPending || !billingConfigured || hasLiveSubscription}
                onClick={() => handleSubscribe(plan.id)}
                className="mt-auto inline-flex h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-bold text-white transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCurrent ? "Plano atual" : subscribingId === plan.id ? "Assinando..." : "Assinar este plano"}
              </button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
