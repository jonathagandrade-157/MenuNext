/**
 * Núcleo do fluxo de assinatura do lojista com o MERCADO PAGO, sem Next.js e
 * sem acesso direto a rede ou banco: tudo entra por `MpSubscribeDeps`. Mesma
 * ideia (e mesmas garantias) do subscribeFlow.ts do Asaas:
 *
 *  1) o BANCO abre a assinatura (valor, plano e provedor saem dele);
 *  2) o servidor reencontra a assinatura desta MESMA tentativa no Mercado Pago
 *     (pela referência do MenuNext) ou cria uma nova — sem cobrança em dobro;
 *  3) lê de volta pela API autenticada e confere valor, moeda, frequência,
 *     referência e status (prova de origem);
 *  4) só então o BACKEND registra os ids;
 *  5) o lojista é levado ao link de pagamento hospedado pelo Mercado Pago
 *     (`init_point`), que só é aceito se for HTTPS de domínio do Mercado Pago.
 *
 * Nenhum passo libera acesso pago: a assinatura fica "pending" e o acesso só é
 * liberado quando uma fatura é paga (webhook assinado + releitura na API, ou
 * reconciliação).
 */
import type {
  MercadoPagoPreapproval,
  MercadoPagoResult,
  MercadoPagoSearch,
} from "./mercadopago";
import { isMercadoPagoCheckoutUrl, verifyMercadoPagoPreapproval } from "./mercadopagoVerify";
import { ALREADY_SUBSCRIBED_MESSAGE, type SubscribeToPlanResult } from "./subscribeFlow";

type RpcOutcome = { data: unknown; error: { message: string } | null };

export type MpSubscribeDeps = {
  beginSubscription(planId: string): PromiseLike<RpcOutcome>;
  getPayerEmail(): Promise<string | null>;
  attachSubscription(args: {
    subscriptionId: string;
    customerId: string;
    providerSubscriptionId: string;
    verifiedAmount: number;
  }): PromiseLike<{ error: { message: string } | null }>;
  /** Para onde o Mercado Pago devolve o lojista depois do pagamento. */
  backUrl: string;
  mp: {
    searchByExternalReference(reference: string): Promise<MercadoPagoResult<MercadoPagoSearch<MercadoPagoPreapproval>>>;
    createPreapproval(params: {
      payerEmail: string;
      amount: number;
      reason: string;
      externalReference: string;
      backUrl: string;
    }): Promise<MercadoPagoResult<MercadoPagoPreapproval>>;
    getPreapproval(id: string): Promise<MercadoPagoResult<MercadoPagoPreapproval>>;
    cancelPreapproval(id: string): Promise<MercadoPagoResult<MercadoPagoPreapproval>>;
  };
};

const GENERIC_START_ERROR = "Não foi possível iniciar sua assinatura. Tente novamente em instantes.";

type BegunSubscription = {
  out_subscription_id: string;
  out_amount: number | string;
  out_plan_name: string;
};

export async function runMercadoPagoSubscribeFlow(planId: string, deps: MpSubscribeDeps): Promise<SubscribeToPlanResult> {
  // 1) O banco abre (ou retoma) a assinatura.
  const { data: begun, error: beginError } = await deps.beginSubscription(planId);
  if (beginError) {
    if (beginError.message.includes("already_subscribed")) return { status: "error", message: ALREADY_SUBSCRIBED_MESSAGE };
    if (beginError.message.includes("plan_not_found") || beginError.message.includes("plan_not_billable")) {
      return { status: "error", message: "Plano não encontrado." };
    }
    if (beginError.message.includes("not_authorized")) {
      return { status: "error", message: "Só o responsável pela loja pode assinar um plano." };
    }
    if (beginError.message.includes("invalid_provider")) {
      return { status: "error", message: "A forma de cobrança foi atualizada. Tente novamente." };
    }
    return { status: "error", message: GENERIC_START_ERROR };
  }
  const attempt = (Array.isArray(begun) ? begun[0] : begun) as BegunSubscription | undefined;
  if (!attempt?.out_subscription_id) return { status: "error", message: GENERIC_START_ERROR };

  const internalId = attempt.out_subscription_id;
  const amount = Number(attempt.out_amount);

  // 2) Reencontra uma assinatura anterior desta MESMA tentativa ou cria uma nova.
  let preapprovalId: string | null = null;
  let createdNow = false;

  const existing = await deps.mp.searchByExternalReference(internalId);
  if (!existing.ok) return { status: "error", message: GENERIC_START_ERROR };

  for (const candidate of existing.data.results ?? []) {
    if (candidate.status !== "pending" && candidate.status !== "authorized") continue;
    const checked = verifyMercadoPagoPreapproval(candidate, {
      preapprovalId: candidate.id,
      amount,
      externalReference: internalId,
    });
    if (checked.ok) {
      preapprovalId = candidate.id;
      break;
    }
    // Sobra de uma tentativa com outro valor (o plano mudou de preço): cancela.
    await deps.mp.cancelPreapproval(candidate.id);
  }

  if (!preapprovalId) {
    const payerEmail = await deps.getPayerEmail();
    if (!payerEmail) {
      return { status: "error", message: "Não foi possível identificar o e-mail de cobrança. Complete seu cadastro e tente novamente." };
    }
    const created = await deps.mp.createPreapproval({
      payerEmail,
      amount,
      reason: `MenuNext — plano ${attempt.out_plan_name}`,
      externalReference: internalId,
      backUrl: deps.backUrl,
    });
    if (!created.ok || typeof created.data?.id !== "string" || !created.data.id) {
      return { status: "error", message: "Não foi possível criar sua assinatura. Tente novamente em instantes." };
    }
    preapprovalId = created.data.id;
    createdNow = true;
  }

  // Desfaz no Mercado Pago o que ESTA chamada criou quando não dá para registrar.
  const rollbackRemote = async () => {
    if (createdNow && preapprovalId) await deps.mp.cancelPreapproval(preapprovalId);
  };

  // 3) Prova de origem: lê de volta pela API autenticada e confere tudo.
  const remote = await deps.mp.getPreapproval(preapprovalId);
  const verdict = remote.ok
    ? verifyMercadoPagoPreapproval(remote.data, { preapprovalId, amount, externalReference: internalId })
    : ({ ok: false, reason: "remote_unavailable" } as const);
  if (!remote.ok || !verdict.ok) {
    await rollbackRemote();
    return { status: "error", message: "Não foi possível confirmar sua assinatura no Mercado Pago. Tente novamente em instantes." };
  }

  // O link de pagamento vem da LEITURA autenticada e só vale se for do Mercado Pago.
  const checkoutUrl = remote.data.init_point;
  if (!isMercadoPagoCheckoutUrl(checkoutUrl)) {
    await rollbackRemote();
    return { status: "error", message: "Não foi possível obter o link de pagamento. Tente novamente em instantes." };
  }

  // 4) O backend registra; o lojista nunca fala com esta RPC. No Mercado Pago o
  //    "cliente" é a própria referência do MenuNext (não há cliente antes da autorização).
  const { error: attachError } = await deps.attachSubscription({
    subscriptionId: internalId,
    customerId: internalId,
    providerSubscriptionId: preapprovalId,
    verifiedAmount: amount,
  });
  if (attachError) {
    await rollbackRemote();
    return { status: "error", message: "Não foi possível registrar sua assinatura. Tente novamente em instantes." };
  }

  return { status: "success", redirectUrl: checkoutUrl };
}
