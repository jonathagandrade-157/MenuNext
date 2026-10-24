/**
 * Reconciliação com a API do Mercado Pago — equivalente do billingReconcile.ts
 * do Asaas. Recupera pagamentos e cancelamentos cujo webhook não chegou e
 * corrige o que um evento atrasado tenha deixado errado. A leitura da API
 * autenticada é a VERDADE naquele instante; o banco aplica pelas RPCs
 * billing_reconcile_* (só service_role), que repetem as verificações de vínculo
 * e de valor e que decidem o que cada status significa (a fatura só vira
 * "confirmada" com fatura processada E pagamento aprovado).
 *
 * Esta lib não conhece rede nem banco: recebe as dependências (testável).
 */
import type {
  MercadoPagoAuthorizedPayment,
  MercadoPagoPreapproval,
  MercadoPagoResult,
  MercadoPagoSearch,
} from "./mercadopago";
import { debitDateToBrasiliaDate } from "./mercadopagoVerify";
import type { ReconcilableRow, ReconcileOutcome, ReconcileSummary, RpcResult } from "./billingReconcile";

export type MercadoPagoReconcileDeps = {
  getPreapproval(id: string): Promise<MercadoPagoResult<MercadoPagoPreapproval>>;
  listAuthorizedPayments(
    preapprovalId: string,
    offset: number,
    limit: number
  ): Promise<MercadoPagoResult<MercadoPagoSearch<MercadoPagoAuthorizedPayment>>>;
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
};

const PAGE_SIZE = 50;
const MAX_PAGES = 5;
const APPLIED = new Set(["applied", "cancelled"]);

function amountOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(n) && n >= 0 && n < 1_000_000 ? n : null;
}

export async function reconcileMercadoPagoSubscription(
  row: ReconcilableRow,
  deps: MercadoPagoReconcileDeps
): Promise<ReconcileOutcome> {
  const outcome: ReconcileOutcome = { status: "ok", payments: 0, applied: 0, errors: 0, subscriptionResult: null };
  if (row.out_provider !== "mercadopago" || !row.out_subscription_ref) return { ...outcome, status: "invalid" };

  const remote = await deps.getPreapproval(row.out_subscription_ref);
  let remoteSubscription: MercadoPagoPreapproval | null = null;
  // No Mercado Pago o "cliente" registrado é a referência do MenuNext; o banco compara.
  let customer = row.out_customer_ref;
  let remoteStatus = "";
  let remoteDeleted = false;

  if (remote.ok) {
    remoteSubscription = remote.data;
    customer = typeof remoteSubscription.external_reference === "string" ? remoteSubscription.external_reference : "";
    remoteStatus = typeof remoteSubscription.status === "string" ? remoteSubscription.status : "";
  } else if (remote.httpStatus === 404) {
    // Removida de vez no Mercado Pago: tratada como cancelamento.
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
    const list = await deps.listAuthorizedPayments(row.out_subscription_ref, page * PAGE_SIZE, PAGE_SIZE);
    if (!list.ok) return { ...outcome, status: "unavailable" };

    const results = list.data.results ?? [];
    for (const payment of results) {
      outcome.payments += 1;
      if ((typeof payment?.id !== "string" && typeof payment?.id !== "number") || typeof payment.status !== "string") {
        outcome.errors += 1;
        continue;
      }
      const result = await deps.rpc("billing_reconcile_payment", {
        p_provider: row.out_provider,
        p_subscription_ref: row.out_subscription_ref,
        p_customer_ref: customer,
        p_payment_ref: String(payment.id),
        // Status combinado "<fatura>/<pagamento>"; o BANCO decide o que significa.
        p_remote_status: `${payment.status}/${payment.payment?.status ?? ""}`,
        p_remote_deleted: false,
        p_value: amountOrNull(payment.transaction_amount),
        p_due_date: debitDateToBrasiliaDate(payment.debit_date),
        p_paid_at: null,
      });
      if (result.error) outcome.errors += 1;
      else if (typeof result.data === "string" && APPLIED.has(result.data)) outcome.applied += 1;
    }

    const total = list.data.paging?.total;
    const seen = page * PAGE_SIZE + results.length;
    const hasMore = typeof total === "number" ? seen < total : results.length === PAGE_SIZE;
    if (!hasMore || results.length === 0) break;
  }
  return outcome;
}

/** Reconcilia um lote respeitando um orçamento de tempo (mesmo resumo do Asaas). */
export async function reconcileMercadoPagoBatch(
  rows: ReconcilableRow[],
  deps: MercadoPagoReconcileDeps,
  options: { deadlineMs?: number; now?: () => number } = {}
): Promise<ReconcileSummary> {
  const now = options.now ?? Date.now;
  const summary: ReconcileSummary = { checked: 0, applied: 0, unavailable: 0, notFound: 0, errors: 0 };
  for (const row of rows) {
    if (options.deadlineMs !== undefined && now() >= options.deadlineMs) break;
    const outcome = await reconcileMercadoPagoSubscription(row, deps);
    summary.checked += 1;
    summary.applied += outcome.applied;
    summary.errors += outcome.errors;
    if (outcome.status === "unavailable") summary.unavailable += 1;
    if (outcome.status === "remote_not_found") summary.notFound += 1;
  }
  return summary;
}
