import type { SupabaseClient } from "@supabase/supabase-js";
import { csvCell, localDateString, MAX_REPORT_ROWS, type ReportPeriod } from "./reports";
import { stockStatus, type StockMovementKind, type StockStatus } from "./stock";

/**
 * Relatório de estoque do período (somente leitura, OWNER): saldo inicial/final e o que entrou e saiu por produto,
 * calculado do livro de movimentações (que guarda delta e saldo resultante). Produto sem nenhuma movimentação até o
 * fim do período não aparece (não há controle). Venda líquida = vendas - estornos de pedidos cancelados.
 */
export type LedgerRow = { product_id: string; kind: StockMovementKind; delta: number; balance_after: number; created_at: string };

export type StockReportRow = {
  productId: string;
  name: string;
  opening: number;
  closing: number;
  entries: number;
  exits: number;
  losses: number;
  sales: number;
  reversals: number;
  netSold: number;
  adjustments: number; // líquido, com sinal
  lowThreshold: number | null;
  status: StockStatus | null;
};

export type StockReport = { rows: StockReportRow[]; totals: { entries: number; exits: number; losses: number; netSold: number; adjustments: number } };

export function computeStockReport(
  products: { id: string; name: string }[],
  ledger: LedgerRow[],
  startIso: string,
  endIso: string,
  thresholds: Map<string, number> = new Map(),
): StockReport {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const byProduct = new Map<string, LedgerRow[]>();
  for (const m of ledger) {
    const t = new Date(m.created_at).getTime();
    if (t >= end) continue;
    byProduct.set(m.product_id, [...(byProduct.get(m.product_id) ?? []), m]);
  }

  const rows: StockReportRow[] = [];
  for (const p of products) {
    const all = (byProduct.get(p.id) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (all.length === 0) continue;
    const before = all.filter((m) => new Date(m.created_at).getTime() < start);
    const inside = all.filter((m) => new Date(m.created_at).getTime() >= start);
    const opening = inside.length > 0 ? inside[0].balance_after - inside[0].delta : before[before.length - 1].balance_after;
    const closing = inside.length > 0 ? inside[inside.length - 1].balance_after : opening;
    const sum = (kind: StockMovementKind) => inside.filter((m) => m.kind === kind).reduce((a, m) => a + m.delta, 0);
    const sales = 0 - sum("sale");
    const reversals = sum("sale_reversal");
    const threshold = thresholds.get(p.id) ?? 0;
    rows.push({
      productId: p.id,
      name: p.name,
      opening,
      closing,
      entries: sum("entry"),
      exits: 0 - sum("exit"),
      losses: 0 - sum("loss"),
      sales,
      reversals,
      netSold: sales - reversals,
      adjustments: sum("adjustment"),
      lowThreshold: thresholds.has(p.id) ? threshold : null,
      status: thresholds.has(p.id) ? stockStatus(closing, threshold) : null,
    });
  }
  rows.sort((a, b) => b.netSold - a.netSold || a.name.localeCompare(b.name, "pt-BR"));
  const total = (f: (r: StockReportRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  return { rows, totals: { entries: total((r) => r.entries), exits: total((r) => r.exits), losses: total((r) => r.losses), netSold: total((r) => r.netSold), adjustments: total((r) => r.adjustments) } };
}

export function stockReportToCsv(rows: StockReportRow[]): string {
  const header = ["Produto", "Saldo inicial", "Entradas", "Saídas", "Perdas", "Vendas", "Estornos", "Venda líquida", "Ajustes", "Saldo final"];
  const lines = [header.map(csvCell).join(";")];
  for (const r of rows) {
    lines.push([r.name, r.opening, r.entries, r.exits, r.losses, r.sales, r.reversals, r.netSold, r.adjustments, r.closing].map((v) => csvCell(typeof v === "number" ? String(v) : v)).join(";"));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

const PAGE = 1000;

export type StockReportData = { products: { id: string; name: string }[]; ledger: LedgerRow[]; thresholds: Map<string, number>; truncated: boolean };

/** Lê produtos, limites e o livro até o fim do período (RLS limita à loja; eq é defesa em profundidade). */
export async function getStockReportData(supabase: SupabaseClient, restaurantId: string, period: ReportPeriod): Promise<StockReportData> {
  const [products, items] = await Promise.all([
    supabase.from("products").select("id, name").eq("restaurant_id", restaurantId).order("name"),
    supabase.from("stock_items").select("product_id, low_threshold").eq("restaurant_id", restaurantId),
  ]);
  if (products.error) throw products.error;
  if (items.error) throw items.error;
  const ledger: LedgerRow[] = [];
  let truncated = true;
  for (let offset = 0; offset < MAX_REPORT_ROWS; offset += PAGE) {
    const { data, error } = await supabase
      .from("stock_movements")
      .select("product_id, kind, delta, balance_after, created_at")
      .eq("restaurant_id", restaurantId)
      .lt("created_at", period.endIso)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as LedgerRow[];
    ledger.push(...page);
    if (page.length < PAGE) {
      truncated = false;
      break;
    }
  }
  return {
    products: (products.data ?? []) as { id: string; name: string }[],
    ledger,
    thresholds: new Map(((items.data ?? []) as { product_id: string; low_threshold: number }[]).map((i) => [i.product_id, i.low_threshold])),
    truncated,
  };
}

export const reportDay = localDateString;
