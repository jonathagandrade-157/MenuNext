import type { SupabaseClient } from "@supabase/supabase-js";

/** Sessão de caixa aberta, com o resumo das vendas de balcão desde a abertura (RPC cash_current). */
export type CashSession = {
  id: string;
  openedAt: string;
  openedByName: string;
  openingAmount: number;
  ordersCount: number;
  totalSales: number;
  cashSales: number;
  pixSales: number;
  cardSales: number;
  expectedCash: number;
};

/** Resumo devolvido ao fechar o caixa (RPC cash_close). */
export type CashClosing = {
  openedAt: string;
  closedAt: string;
  openingAmount: number;
  ordersCount: number;
  totalSales: number;
  cashSales: number;
  pixSales: number;
  cardSales: number;
  expectedCash: number;
  countedCash: number;
  difference: number;
};

/** Linha do histórico (RPC cash_history, só o OWNER recebe linhas). */
export type CashHistoryRow = {
  id: string;
  openedAt: string;
  closedAt: string | null;
  openedByName: string;
  closedByName: string | null;
  openingAmount: number;
  countedCash: number | null;
  expectedCash: number | null;
  difference: number | null;
  ordersCount: number;
  totalSales: number;
  notes: string | null;
};

type Row = Record<string, unknown>;

const num = (v: unknown) => Number(v ?? 0);
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function parseCashSession(row: Row): CashSession {
  return {
    id: String(row.session_id),
    openedAt: String(row.opened_at),
    openedByName: String(row.opened_by_name ?? ""),
    openingAmount: num(row.opening_amount),
    ordersCount: num(row.orders_count),
    totalSales: num(row.total_sales),
    cashSales: num(row.cash_sales),
    pixSales: num(row.pix_sales),
    cardSales: num(row.card_sales),
    expectedCash: num(row.expected_cash),
  };
}

export function parseCashClosing(row: Row): CashClosing {
  return {
    openedAt: String(row.opened_at),
    closedAt: String(row.closed_at),
    openingAmount: num(row.opening_amount),
    ordersCount: num(row.orders_count),
    totalSales: num(row.total_sales),
    cashSales: num(row.cash_sales),
    pixSales: num(row.pix_sales),
    cardSales: num(row.card_sales),
    expectedCash: num(row.expected_cash),
    countedCash: num(row.counted_cash),
    difference: num(row.difference),
  };
}

export function parseCashHistoryRow(row: Row): CashHistoryRow {
  return {
    id: String(row.session_id),
    openedAt: String(row.opened_at),
    closedAt: row.closed_at ? String(row.closed_at) : null,
    openedByName: String(row.opened_by_name ?? ""),
    closedByName: row.closed_by_name ? String(row.closed_by_name) : null,
    openingAmount: num(row.opening_amount),
    countedCash: numOrNull(row.counted_cash),
    expectedCash: numOrNull(row.expected_cash),
    difference: numOrNull(row.difference),
    ordersCount: num(row.orders_count),
    totalSales: num(row.total_sales),
    notes: row.notes ? String(row.notes) : null,
  };
}

/** Sessão aberta da loja do usuário (null = caixa fechado). */
export async function getCurrentCashSession(supabase: SupabaseClient): Promise<CashSession | null> {
  const { data, error } = await supabase.rpc("cash_current");
  if (error) throw error;
  const row = (data as Row[] | null)?.[0];
  return row ? parseCashSession(row) : null;
}

/** Últimas sessões (só o OWNER recebe linhas; para o STAFF a lista vem vazia). */
export async function getCashHistory(supabase: SupabaseClient, limit = 20): Promise<CashHistoryRow[]> {
  const { data, error } = await supabase.rpc("cash_history", { p_limit: limit });
  if (error) throw error;
  return ((data as Row[] | null) ?? []).map(parseCashHistoryRow);
}

/** Mensagens da RPC em português; qualquer outra vira uma mensagem genérica (nunca expõe o erro técnico). */
export function friendlyCashError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("cash_already_open")) return "O caixa já está aberto.";
  if (m.includes("cash_not_open")) return "O caixa não está aberto.";
  if (m.includes("invalid_amount")) return "Informe um valor válido, entre R$ 0,00 e R$ 99.999.999,99.";
  if (m.includes("not_authorized")) return "Você não tem acesso ao caixa desta loja.";
  if (m.includes("insufficient_cash")) return "A sangria é maior que o dinheiro disponível no caixa.";
  if (m.includes("invalid_reason")) return "Informe o motivo (até 200 caracteres).";
  if (m.includes("invalid_kind")) return "Tipo de movimentação inválido.";
  return "Não foi possível concluir agora. Tente novamente.";
}

// ---------------------------------------------------------------------------
// Movimentações do caixa (suprimento / sangria) — migration 20261105010000_cash_movements
// ---------------------------------------------------------------------------
export type CashMovementKind = "supply" | "withdrawal";
export const CASH_MOVEMENT_LABELS: Record<CashMovementKind, string> = { supply: "Suprimento", withdrawal: "Sangria" };
export const CASH_REASON_MAX_LENGTH = 200;

export type CashMovement = {
  id: string;
  kind: CashMovementKind;
  amount: number;
  reason: string;
  createdByName: string;
  createdAt: string;
};

export function parseCashMovement(row: Row): CashMovement {
  return {
    id: String(row.id),
    kind: row.kind === "withdrawal" ? "withdrawal" : "supply",
    amount: num(row.amount),
    reason: String(row.reason ?? ""),
    createdByName: String(row.created_by_name ?? ""),
    createdAt: String(row.created_at),
  };
}

export type CashMovementInput = { kind: CashMovementKind; amount: number; reason: string };

export function validateCashMovement(kind: unknown, rawAmount: number | null, rawReason: unknown): { ok: true; value: CashMovementInput } | { ok: false; error: string } {
  if (kind !== "supply" && kind !== "withdrawal") return { ok: false, error: "Escolha suprimento ou sangria." };
  if (rawAmount === null || !Number.isFinite(rawAmount) || rawAmount <= 0) return { ok: false, error: "Informe um valor maior que zero." };
  if (rawAmount > 99999999.99) return { ok: false, error: "Valor alto demais." };
  const reason = typeof rawReason === "string" ? rawReason.trim() : "";
  if (!reason) return { ok: false, error: "Informe o motivo." };
  if (reason.length > CASH_REASON_MAX_LENGTH) return { ok: false, error: `O motivo deve ter até ${CASH_REASON_MAX_LENGTH} caracteres.` };
  return { ok: true, value: { kind, amount: Math.round(rawAmount * 100) / 100, reason } };
}

/** True quando o erro significa "a função não existe neste banco" (migration ainda não aplicada). */
export function isMissingRpc(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function|does not exist/i.test(error.message ?? "");
}

export type CashMovementsResult = { available: boolean; rows: CashMovement[] };

/**
 * Movimentações da sessão aberta. Se a migration ainda não foi aplicada, devolve available=false e a tela esconde o
 * recurso (o resto do caixa funciona normalmente). Qualquer outro erro é propagado.
 */
export async function getCashMovements(supabase: SupabaseClient): Promise<CashMovementsResult> {
  const { data, error } = await supabase.rpc("cash_movements_list");
  if (isMissingRpc(error)) return { available: false, rows: [] };
  if (error) throw error;
  return { available: true, rows: ((data as Row[] | null) ?? []).map(parseCashMovement) };
}

export type CashAmountValidation = { ok: true; value: number } | { ok: false; error: string };

/** Valor digitado na abertura/fechamento: número finito, >= 0, com no máximo 2 casas (centavos). */
export function validateCashAmount(raw: number | null): CashAmountValidation {
  if (raw === null || !Number.isFinite(raw)) return { ok: false, error: "Informe um valor válido." };
  if (raw < 0) return { ok: false, error: "O valor não pode ser negativo." };
  if (raw > 99999999.99) return { ok: false, error: "Valor alto demais." };
  return { ok: true, value: Math.round(raw * 100) / 100 };
}

export type CashDifference = { kind: "ok" | "over" | "short"; label: string };

/** Diferença de caixa (contado - esperado), em palavras. Meio centavo de tolerância contra arredondamento. */
export function describeCashDifference(difference: number): CashDifference {
  const cents = Math.round(difference * 100);
  const abs = Math.abs(cents) / 100;
  const money = abs.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (cents === 0) return { kind: "ok", label: "Caixa batendo" };
  if (cents > 0) return { kind: "over", label: `Sobrou ${money}` };
  return { kind: "short", label: `Faltou ${money}` };
}

const SP = "America/Sao_Paulo";

/** "24/10 10:32" — fuso fixo da operação, igual no servidor e no navegador (sem divergência de hidratação). */
export function formatCashDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: SP, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function formatCashTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: SP, hour: "2-digit", minute: "2-digit" });
}

/** Troco a devolver: dinheiro recebido - total da venda (null enquanto o valor não cobre a venda). */
export function changeToGiveBack(received: number | null, total: number): number | null {
  if (received === null || !Number.isFinite(received)) return null;
  const cents = Math.round((received - total) * 100);
  return cents >= 0 ? cents / 100 : null;
}

// ---------------------------------------------------------------------------
// Vendas de uma sessão de caixa — migration 20261106000000_cash_session_sales
// ---------------------------------------------------------------------------
export type CashSale = {
  orderId: string;
  orderNumber: number;
  createdAt: string;
  paymentMethod: "cash" | "pix" | "card";
  status: string;
  total: number;
};

export function parseCashSale(row: Row): CashSale {
  const method = row.payment_method === "pix" || row.payment_method === "card" ? row.payment_method : "cash";
  return {
    orderId: String(row.order_id),
    orderNumber: num(row.order_number),
    createdAt: String(row.created_at),
    paymentMethod: method,
    status: String(row.status ?? ""),
    total: num(row.total),
  };
}

export type CashSalesBreakdown = {
  orders: number;
  cancelled: number;
  total: number;
  byPayment: Record<"cash" | "pix" | "card", { orders: number; total: number }>;
};

const cents = (n: number) => Math.round(n * 100);

/** Resumo da sessão: canceladas não entram nos totais (mesma regra de _cash_totals). Soma em centavos. */
export function summarizeCashSales(sales: CashSale[]): CashSalesBreakdown {
  const byPayment = { cash: { orders: 0, total: 0 }, pix: { orders: 0, total: 0 }, card: { orders: 0, total: 0 } };
  let totalCents = 0;
  let orders = 0;
  let cancelled = 0;
  const cents_by = { cash: 0, pix: 0, card: 0 };
  for (const s of sales) {
    if (s.status === "cancelled") {
      cancelled += 1;
      continue;
    }
    orders += 1;
    totalCents += cents(s.total);
    cents_by[s.paymentMethod] += cents(s.total);
    byPayment[s.paymentMethod].orders += 1;
  }
  for (const k of ["cash", "pix", "card"] as const) byPayment[k].total = cents_by[k] / 100;
  return { orders, cancelled, total: totalCents / 100, byPayment };
}

export type CashSalesResult = { available: boolean; sales: CashSale[] };

/** Vendas da sessão aberta (sessionId nulo) ou de uma sessão fechada (só OWNER). Sem a migration: available=false. */
export async function getCashSessionSales(supabase: SupabaseClient, sessionId: string | null = null): Promise<CashSalesResult> {
  const { data, error } = await supabase.rpc("cash_session_sales", { p_session: sessionId });
  if (isMissingRpc(error)) return { available: false, sales: [] };
  if (error) throw error;
  return { available: true, sales: ((data as Row[] | null) ?? []).map(parseCashSale) };
}

/** Movimentações de uma sessão específica (só OWNER; a RPC devolve vazio aos demais). */
export async function getCashMovementsForSession(supabase: SupabaseClient, sessionId: string): Promise<CashMovementsResult> {
  const { data, error } = await supabase.rpc("cash_movements_list", { p_session: sessionId });
  if (isMissingRpc(error)) return { available: false, rows: [] };
  if (error) throw error;
  return { available: true, rows: ((data as Row[] | null) ?? []).map(parseCashMovement) };
}
