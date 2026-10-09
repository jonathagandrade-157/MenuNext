/**
 * Núcleo do fluxo de assinatura do lojista, sem Next.js e sem acesso direto a
 * rede ou banco: tudo entra por `SubscribeDeps`. A Server Action
 * (src/lib/actions/subscription.ts) só monta as dependências reais; os testes de
 * integração montam as de laboratório.
 *
 * Passos: 1) o BANCO abre a assinatura (valor e plano saem dele); 2) o servidor
 * reencontra ou cria a assinatura no Asaas com a referência do MenuNext; 3) lê de
 * volta pela API autenticada e confere cliente, valor, status e referência
 * (prova de origem); 4) só então o BACKEND registra os ids. Nenhum passo libera
 * acesso pago.
 */
import type { AsaasList, AsaasResult, AsaasSubscription, AsaasSubscriptionDetail, AsaasCustomer } from "./asaas";
import { verifyAsaasSubscription } from "./billingVerify";

export type SubscribeToPlanResult = { status: "success" } | { status: "error"; message: string };

type RpcOutcome = { data: unknown; error: { message: string } | null };

export type SubscribeDeps = {
  beginSubscription(planId: string): PromiseLike<RpcOutcome>;
  getBillingProfile(): Promise<{ name: string; document: string; email: string } | null>;
  attachSubscription(args: {
    subscriptionId: string;
    customerId: string;
    providerSubscriptionId: string;
    verifiedAmount: number;
  }): PromiseLike<{ error: { message: string } | null }>;
  asaas: {
    listByExternalReference(reference: string): Promise<AsaasResult<AsaasList<AsaasSubscriptionDetail>>>;
    createCustomer(params: { name: string; email: string; cpfCnpj: string }): Promise<AsaasResult<AsaasCustomer>>;
    createSubscription(params: {
      customerId: string;
      value: number;
      description: string;
      externalReference: string;
    }): Promise<AsaasResult<AsaasSubscription>>;
    deleteSubscription(id: string): Promise<AsaasResult<{ deleted: boolean }>>;
    getSubscription(id: string): Promise<AsaasResult<AsaasSubscriptionDetail>>;
  };
};

export const ALREADY_SUBSCRIBED_MESSAGE =
  "Seu restaurante já tem uma assinatura. Se há pagamento pendente ou atrasado, finalize-o pelo link que o Asaas enviou ao seu e-mail.";
const GENERIC_START_ERROR = "Não foi possível iniciar sua assinatura. Tente novamente em instantes.";

type BegunSubscription = {
  out_subscription_id: string;
  out_amount: number | string;
  out_plan_name: string;
};

export async function runSubscribeFlow(planId: string, deps: SubscribeDeps): Promise<SubscribeToPlanResult> {
  // 1) O banco abre (ou retoma) a assinatura: assinatura viva não duplica e o
  //    valor vem do plano, não do navegador.
  const { data: begun, error: beginError } = await deps.beginSubscription(planId);
  if (beginError) {
    if (beginError.message.includes("already_subscribed")) return { status: "error", message: ALREADY_SUBSCRIBED_MESSAGE };
    if (beginError.message.includes("plan_not_found") || beginError.message.includes("plan_not_billable")) {
      return { status: "error", message: "Plano não encontrado." };
    }
    if (beginError.message.includes("not_authorized")) {
      return { status: "error", message: "Só o responsável pela loja pode assinar um plano." };
    }
    return { status: "error", message: GENERIC_START_ERROR };
  }
  const attempt = (Array.isArray(begun) ? begun[0] : begun) as BegunSubscription | undefined;
  if (!attempt?.out_subscription_id) return { status: "error", message: GENERIC_START_ERROR };

  const internalId = attempt.out_subscription_id;
  const amount = Number(attempt.out_amount);

  // 2) Reencontra uma assinatura anterior desta MESMA tentativa (evita cobrança
  //    em dobro se um clique anterior morreu no meio) ou cria uma nova.
  let customerId: string | null = null;
  let providerSubscriptionId: string | null = null;
  let createdNow = false;

  const existing = await deps.asaas.listByExternalReference(internalId);
  if (!existing.ok) return { status: "error", message: GENERIC_START_ERROR };

  for (const candidate of existing.data.data ?? []) {
    if (candidate.deleted || candidate.status !== "ACTIVE") continue;
    const checked = verifyAsaasSubscription(candidate, {
      subscriptionId: candidate.id,
      customerId: candidate.customer,
      amount,
      externalReference: internalId,
    });
    if (checked.ok) {
      customerId = candidate.customer;
      providerSubscriptionId = candidate.id;
      break;
    }
    // Sobra de uma tentativa com outro valor (o plano mudou de preço): remove.
    await deps.asaas.deleteSubscription(candidate.id);
  }

  if (!providerSubscriptionId || !customerId) {
    const profile = await deps.getBillingProfile();
    if (!profile?.document || !profile.email) {
      return { status: "error", message: "Não foi possível identificar seus dados de cobrança. Complete seu cadastro e tente novamente." };
    }

    const customerResult = await deps.asaas.createCustomer({
      name: profile.name,
      email: profile.email,
      cpfCnpj: profile.document,
    });
    if (!customerResult.ok) {
      return { status: "error", message: "Não foi possível criar seu cadastro de cobrança. Tente novamente em instantes." };
    }

    const subscriptionResult = await deps.asaas.createSubscription({
      customerId: customerResult.data.id,
      value: amount,
      description: `MenuNext — plano ${attempt.out_plan_name}`,
      externalReference: internalId,
    });
    if (!subscriptionResult.ok) {
      return { status: "error", message: "Não foi possível criar sua assinatura. Tente novamente em instantes." };
    }
    customerId = customerResult.data.id;
    providerSubscriptionId = subscriptionResult.data.id;
    createdNow = true;
  }

  // Desfaz no Asaas o que ESTA chamada criou quando não dá para registrar.
  const rollbackRemote = async () => {
    if (createdNow && providerSubscriptionId) await deps.asaas.deleteSubscription(providerSubscriptionId);
  };

  // 3) Prova de origem: lê de volta pela API autenticada e confere tudo.
  const remote = await deps.asaas.getSubscription(providerSubscriptionId);
  const verdict = remote.ok
    ? verifyAsaasSubscription(remote.data, {
        subscriptionId: providerSubscriptionId,
        customerId,
        amount,
        externalReference: internalId,
      })
    : ({ ok: false, reason: "remote_unavailable" } as const);
  if (!verdict.ok) {
    await rollbackRemote();
    return { status: "error", message: "Não foi possível confirmar sua assinatura no Asaas. Tente novamente em instantes." };
  }

  // 4) O backend registra; o lojista nunca fala com esta RPC.
  const { error: attachError } = await deps.attachSubscription({
    subscriptionId: internalId,
    customerId,
    providerSubscriptionId,
    verifiedAmount: amount,
  });
  if (attachError) {
    await rollbackRemote();
    return { status: "error", message: "Não foi possível registrar sua assinatura. Tente novamente em instantes." };
  }

  return { status: "success" };
}
