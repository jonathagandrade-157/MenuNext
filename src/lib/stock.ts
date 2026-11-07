import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Estoque (controle interno do lojista). O saldo é gravado só pelas RPCs stock_record_movement/stock_set_threshold
 * (OWNER) e NÃO baixa sozinho com as vendas nem bloqueia pedidos. Aqui ficam as regras puras (validação, status,
 * ordenação) e a leitura; a escrita está em src/lib/actions/stock.ts.
 */
export type StockMovementKind = "entry" | "exit" | "loss" | "adjustment";

export const STOCK_KINDS: StockMovementKind[] = ["entry", "exit", "loss", "adjustment"];

export const STOCK_KIND_LABELS: Record<StockMovementKind, string> = {
  entry: "Entrada",
  exit: "Saída",
  loss: "Perda",
  adjustment: "Ajuste (contagem)",
};

export const STOCK_MAX_QUANTITY = 1_000_000;
export const STOCK_NOTE_MAX_LENGTH = 200;

export type StockStatus = "ok" | "low" | "out";

/** "out" = saldo zero; "low" = saldo no limite do alerta (ou abaixo) quando o alerta está ligado (limite > 0). */
export function stockStatus(quantity: number, lowThreshold: number): StockStatus {
  if (quantity <= 0) return "out";
  if (lowThreshold > 0 && quantity <= lowThreshold) return "low";
  return "ok";
}

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  ok: "Em estoque",
  low: "Estoque baixo",
  out: "Sem estoque",
};

export type StockValidation<T> = { ok: true; value: T } | { ok: false; error: string };

/** Aceita só inteiros (texto ou número). `allowZero` vale para ajuste de contagem e para o limite do alerta. */
export function parseStockInteger(raw: unknown, allowZero: boolean): StockValidation<number> {
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d{1,7}$/.test(text)) return { ok: false, error: "Informe um número inteiro, sem vírgula nem sinal." };
  const value = Number(text);
  if (value > STOCK_MAX_QUANTITY) return { ok: false, error: `O máximo é ${STOCK_MAX_QUANTITY.toLocaleString("pt-BR")}.` };
  if (value === 0 && !allowZero) return { ok: false, error: "A quantidade precisa ser maior que zero." };
  return { ok: true, value };
}

export type StockMovementInput = { kind: StockMovementKind; quantity: number; note: string | null };

export function validateStockMovement(kind: unknown, rawQuantity: unknown, rawNote: unknown): StockValidation<StockMovementInput> {
  if (typeof kind !== "string" || !STOCK_KINDS.includes(kind as StockMovementKind)) {
    return { ok: false, error: "Escolha o tipo da movimentação." };
  }
  const quantity = parseStockInteger(rawQuantity, kind === "adjustment");
  if (!quantity.ok) return quantity;
  const note = typeof rawNote === "string" ? rawNote.trim() : "";
  if (note.length > STOCK_NOTE_MAX_LENGTH) {
    return { ok: false, error: `A observação deve ter até ${STOCK_NOTE_MAX_LENGTH} caracteres.` };
  }
  return { ok: true, value: { kind: kind as StockMovementKind, quantity: quantity.value, note: note || null } };
}

/** IDs do Supabase são UUID; recusa qualquer outra coisa antes de chamar o banco. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function friendlyStockError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("insufficient_stock")) return "A saída é maior que o saldo disponível.";
  if (m.includes("no_change")) return "O saldo contado é igual ao saldo atual. Nada a ajustar.";
  if (m.includes("quantity_too_large")) return "O saldo resultante passaria do máximo permitido.";
  if (m.includes("invalid_quantity")) return "Quantidade inválida.";
  if (m.includes("invalid_threshold")) return "Limite de alerta inválido.";
  if (m.includes("invalid_kind")) return "Tipo de movimentação inválido.";
  if (m.includes("note_too_long")) return `A observação deve ter até ${STOCK_NOTE_MAX_LENGTH} caracteres.`;
  if (m.includes("not_authorized")) return "Somente o proprietário da loja pode alterar o estoque.";
  return "Não foi possível concluir agora. Tente novamente.";
}

export type StockRow = {
  productId: string;
  name: string;
  isAvailable: boolean;
  tracked: boolean;
  quantity: number;
  lowThreshold: number;
  status: StockStatus | "untracked";
};

type ProductLite = { id: string; name: string; is_available: boolean };
type ItemLite = { product_id: string; quantity: number; low_threshold: number };

const STATUS_ORDER: Record<StockRow["status"], number> = { out: 0, low: 1, ok: 2, untracked: 3 };

/** Junta produtos e saldos. Produto sem linha de estoque é "não controlado" (não entra nos alertas). */
export function buildStockRows(products: ProductLite[], items: ItemLite[]): StockRow[] {
  const byProduct = new Map(items.map((item) => [item.product_id, item]));
  return products
    .map((product): StockRow => {
      const item = byProduct.get(product.id);
      if (!item) {
        return { productId: product.id, name: product.name, isAvailable: product.is_available, tracked: false, quantity: 0, lowThreshold: 0, status: "untracked" };
      }
      return {
        productId: product.id,
        name: product.name,
        isAvailable: product.is_available,
        tracked: true,
        quantity: item.quantity,
        lowThreshold: item.low_threshold,
        status: stockStatus(item.quantity, item.low_threshold),
      };
    })
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name, "pt-BR"));
}

export type StockSummary = { tracked: number; low: number; out: number };

export function summarizeStock(rows: StockRow[]): StockSummary {
  return {
    tracked: rows.filter((r) => r.tracked).length,
    low: rows.filter((r) => r.status === "low").length,
    out: rows.filter((r) => r.status === "out").length,
  };
}

export type StockMovementRow = {
  id: string;
  productId: string;
  productName: string;
  kind: StockMovementKind;
  delta: number;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
};

export type StockOverview = { rows: StockRow[]; movements: StockMovementRow[] };

const RECENT_MOVEMENTS = 30;

/** Leitura para a tela (qualquer membro lê; a escrita é só do OWNER). */
export async function getStockOverview(supabase: SupabaseClient, restaurantId: string): Promise<StockOverview> {
  const [products, items, movements] = await Promise.all([
    supabase.from("products").select("id, name, is_available").eq("restaurant_id", restaurantId).order("name"),
    supabase.from("stock_items").select("product_id, quantity, low_threshold").eq("restaurant_id", restaurantId),
    supabase
      .from("stock_movements")
      .select("id, product_id, kind, delta, balance_after, note, created_at")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false })
      .limit(RECENT_MOVEMENTS),
  ]);
  if (products.error) throw products.error;
  if (items.error) throw items.error;
  if (movements.error) throw movements.error;

  const productList = (products.data ?? []) as ProductLite[];
  const names = new Map(productList.map((p) => [p.id, p.name]));
  return {
    rows: buildStockRows(productList, (items.data ?? []) as ItemLite[]),
    movements: ((movements.data ?? []) as Record<string, unknown>[]).map((m) => ({
      id: String(m.id),
      productId: String(m.product_id),
      productName: names.get(String(m.product_id)) ?? "Produto removido",
      kind: m.kind as StockMovementKind,
      delta: Number(m.delta),
      balanceAfter: Number(m.balance_after),
      note: (m.note as string | null) ?? null,
      createdAt: String(m.created_at),
    })),
  };
}
