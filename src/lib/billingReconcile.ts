/**
 * Reconciliação com a API do Asaas: recupera pagamentos/cancelamentos cujo
 * webhook não foi entregue e corrige o que um evento forjado ou atrasado tenha
 * deixado errado. A leitura da API autenticada é a VERDADE naquele instante; o
 * banco aplica pelas RPCs billing_reconcile_* (só service_role), que repetem as
 * mesmas verificações de cliente e valor.
 *
 * Esta lib não conhece rede nem banco: recebe as dependências (testável).
 */
import type { AsaasList, AsaasPaymentDetail, AsaasResult, AsaasSubscriptionDetail } from "./asaas";
import { dateOnly } from "./billingVerify";

export type RpcResult = { data: unknown; error: { message: string } | null };

export type ReconcileDeps = {
  getSubscription(id: string): Promise<AsaasResult<AsaasSubscriptionDetail>>;
  listPayments(id: string, offset: number, limit: number): Promise<AsaasResult<AsaasList<AsaasPaymentDetail>>>;
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
};

export type ReconcilableRow = {
  out_provider: string;
  out_subscription_ref: string;
  out_customer_ref: string;
};

export type ReconcileOutcome = {
  /** ok = leu e aplicou; unavailable = API indisponível (tenta de novo depois). */
  status: "ok" | "unavailable" | "remote_not_found" | "invalid";
  payments: number;
  applied: number;
  errors: number;
  subscriptionResult: string | null;
};

const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const APPLIED = new Set(["applied", "cancelled"]);

export async function reconcileSubscription(row: ReconcilableRow, deps: ReconcileDeps): Promise<ReconcileOutcome> {
  const outcome: ReconcileOutcome = { status: "ok", payments: 0, applied: 0, errors: 0, subscriptionResult: null };
  if (row.out_provider !== "asaas" || !row.out_subscription_ref) return { ...outcome, status: "invalid" };

  const remote = await deps.getSubscription(row.out_subscription_ref);
  let remoteSubscription: AsaasSubscriptionDetail | null = null;
  let customer = row.out_customer_ref;
  let remoteStatus = "";
  let remoteDeleted = false;

  if (remote.ok) {
    remoteSubscription = remote.data;
    customer = remoteSubscription.customer; // o banco compara com o cliente registrado
    remoteStatus = remoteSubscription.status;
    remoteDeleted = Boolean(remoteSubscription.deleted);
  } else if (remote.httpStatus === 404) {
    // Removida de vez no Asaas: tratada como cancelamento.
    remoteDeleted = true;
  } else {
    return { ...outcome, status: "unavailable" };
  }

  const subResult = await deps.rpc("billing_reconcile_subscription", {
    p_provider: row.out_provider,
    p_subscription_ref: row.out_subscription_ref,
    p_customer_ref: customer,
    p_remote_status: remoteStatus,
    p_remote_deleted: remoteDeleted,
  });
  if (subResult.error) {
    outcome.errors += 1;
  } else {
    outcome.subscriptionResult = typeof subResult.data === "string" ? subResult.data : null;
    if (outcome.subscriptionResult && APPLIED.has(outcome.subscriptionResult)) outcome.applied += 1;
  }
  if (!remoteSubscription) return { ...outcome, status: "remote_not_found" };

  for (let page = 0; page < MAX_PAGES; page++) {
    const list = await deps.listPayments(row.out_subscription_ref, page * PAGE_SIZE, PAGE_SIZE);
    if (!list.ok) return { ...outcome, status: "unavailable" };

    for (const payment of list.data.data ?? []) {
      outcome.payments += 1;
      if (typeof payment?.id !== "string" || typeof payment.status !== "string") {
        outcome.errors += 1;
        continue;
      }
      const result = await deps.rpc("billing_reconcile_payment", {
        p_provider: row.out_provider,
        p_subscription_ref: row.out_subscription_ref,
        p_customer_ref: payment.customer,
        p_payment_ref: payment.id,
        p_remote_status: payment.status,
        p_remote_deleted: Boolean(payment.deleted),
        p_value: typeof payment.value === "number" ? payment.value : null,
        p_due_date: dateOnly(payment.dueDate),
        p_paid_at: dateOnly(payment.paymentDate),
      });
      if (result.error) outcome.errors += 1;
      else if (typeof result.data === "string" && APPLIED.has(result.data)) outcome.applied += 1;
    }
    if (!list.data.hasMore) break;
  }
  return outcome;
}

export type ReconcileSummary = {
  checked: number;
  applied: number;
  unavailable: number;
  notFound: number;
  errors: number;
};

/** Reconcilia um lote respeitando um orçamento de tempo. */
export async function reconcileBatch(
  rows: ReconcilableRow[],
  deps: ReconcileDeps,
  options: { deadlineMs?: number; now?: () => number } = {}
): Promise<ReconcileSummary> {
  const now = options.now ?? Date.now;
  const summary: ReconcileSummary = { checked: 0, applied: 0, unavailable: 0, notFound: 0, errors: 0 };
  for (const row of rows) {
    if (options.deadlineMs !== undefined && now() >= options.deadlineMs) break;
    const outcome = await reconcileSubscription(row, deps);
    summary.checked += 1;
    summary.applied += outcome.applied;
    summary.errors += outcome.errors;
    if (outcome.status === "unavailable") summary.unavailable += 1;
    if (outcome.status === "remote_not_found") summary.notFound += 1;
  }
  return summary;
}
