import type { SupabaseClient } from "@supabase/supabase-js";

/** Promoção automática (tabela promotions). Desconto sobre o subtotal, aplicado sozinho quando as condições valem. */
export type Promotion = {
  id: string;
  restaurant_id: string;
  name: string;
  discount_type: "percent" | "fixed";
  discount_value: number;
  min_order_value: number | null;
  starts_at: string | null;
  ends_at: string | null;
  /** 0 = domingo ... 6 = sábado; null = todos os dias */
  weekdays: number[] | null;
  /** "HH:MM:SS" do Postgres; ambos nulos = o dia todo */
  time_from: string | null;
  time_to: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const SP = "America/Sao_Paulo";
export const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

type Row = Record<string, unknown>;

export function parsePromotion(row: Row): Promotion {
  return {
    id: String(row.id),
    restaurant_id: String(row.restaurant_id),
    name: String(row.name),
    discount_type: row.discount_type === "fixed" ? "fixed" : "percent",
    discount_value: Number(row.discount_value),
    min_order_value: row.min_order_value === null || row.min_order_value === undefined ? null : Number(row.min_order_value),
    starts_at: row.starts_at ? String(row.starts_at) : null,
    ends_at: row.ends_at ? String(row.ends_at) : null,
    weekdays: Array.isArray(row.weekdays) ? (row.weekdays as unknown[]).map(Number) : null,
    time_from: row.time_from ? String(row.time_from) : null,
    time_to: row.time_to ? String(row.time_to) : null,
    is_active: row.is_active === true,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function getPromotions(supabase: SupabaseClient, restaurantId: string): Promise<Promotion[]> {
  const { data, error } = await supabase
    .from("promotions")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data as Row[] | null) ?? []).map(parsePromotion);
}

// ---------------------------------------------------------------------------
// Formulário (validação pura — a action só chama isto e grava)
// ---------------------------------------------------------------------------

export type PromotionFormData = {
  name: string;
  discount_type: "percent" | "fixed";
  discount_value: number;
  min_order_value: number | null;
  starts_at: string | null;
  ends_at: string | null;
  weekdays: number[] | null;
  time_from: string | null;
  time_to: string | null;
};

export type PromotionFormResult = { ok: true; data: PromotionFormData } | { ok: false; error: string };

/** null para vazio, NaN para "preenchido mas inválido". */
function optionalDecimal(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : NaN;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Datas puras do formulário viram instantes no fuso de São Paulo (UTC-3, sem horário de verão desde 2019). */
function startOfDayIso(date: string): string | null {
  const d = new Date(`${date}T00:00:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function endOfDayIso(date: string): string | null {
  const d = new Date(`${date}T23:59:59-03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function readPromotionForm(formData: FormData): PromotionFormResult {
  const name = String(formData.get("name") ?? "").trim();
  const discountType = String(formData.get("discount_type") ?? "");
  const startsOn = String(formData.get("starts_on") ?? "").trim();
  const endsOn = String(formData.get("ends_on") ?? "").trim();
  const timeFrom = String(formData.get("time_from") ?? "").trim();
  const timeTo = String(formData.get("time_to") ?? "").trim();

  if (name.length < 2 || name.length > 60) return { ok: false, error: "Dê um nome à promoção, de 2 a 60 caracteres." };
  if (discountType !== "percent" && discountType !== "fixed") return { ok: false, error: "Selecione o tipo de desconto." };

  const discountValue = optionalDecimal(String(formData.get("discount_value") ?? ""));
  if (discountValue === null || Number.isNaN(discountValue) || discountValue <= 0) {
    return { ok: false, error: "Informe um valor de desconto válido." };
  }
  if (discountType === "percent" && discountValue > 100) return { ok: false, error: "O desconto percentual não pode passar de 100%." };
  if (discountValue > 99999999.99) return { ok: false, error: "Valor de desconto alto demais." };

  const minOrder = optionalDecimal(String(formData.get("min_order_value") ?? ""));
  if (Number.isNaN(minOrder) || (minOrder !== null && minOrder < 0)) return { ok: false, error: "Informe um pedido mínimo válido." };

  let startsAt: string | null = null;
  let endsAt: string | null = null;
  if (startsOn) {
    startsAt = DATE_RE.test(startsOn) ? startOfDayIso(startsOn) : null;
    if (!startsAt) return { ok: false, error: "Informe uma data de início válida." };
  }
  if (endsOn) {
    endsAt = DATE_RE.test(endsOn) ? endOfDayIso(endsOn) : null;
    if (!endsAt) return { ok: false, error: "Informe uma data de término válida." };
  }
  if (startsAt && endsAt && endsAt <= startsAt) return { ok: false, error: "A data de término deve ser depois da data de início." };

  const days = formData
    .getAll("weekdays")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  const uniqueDays = [...new Set(days)].sort((a, b) => a - b);
  const weekdays = uniqueDays.length === 0 || uniqueDays.length === 7 ? null : uniqueDays;

  if ((timeFrom === "") !== (timeTo === "")) return { ok: false, error: "Informe o horário de início e o de fim, ou deixe os dois em branco." };
  if (timeFrom && (!TIME_RE.test(timeFrom) || !TIME_RE.test(timeTo))) return { ok: false, error: "Informe horários válidos (HH:MM)." };
  if (timeFrom && timeFrom >= timeTo) return { ok: false, error: "O horário de fim deve ser depois do horário de início (a janela não atravessa a meia-noite)." };

  return {
    ok: true,
    data: {
      name,
      discount_type: discountType,
      discount_value: discountValue,
      min_order_value: minOrder,
      starts_at: startsAt,
      ends_at: endsAt,
      weekdays,
      time_from: timeFrom || null,
      time_to: timeTo || null,
    },
  };
}

export function friendlyPromotionError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("row-level security") || m.includes("permission denied")) return "Só o dono da loja pode alterar promoções.";
  if (m.includes("check")) return "Alguma condição da promoção não é válida. Revise os campos.";
  return "Não foi possível salvar. Tente novamente.";
}

// ---------------------------------------------------------------------------
// Exibição
// ---------------------------------------------------------------------------

export function describeDiscount(p: Pick<Promotion, "discount_type" | "discount_value">): string {
  return p.discount_type === "percent"
    ? `${p.discount_value.toLocaleString("pt-BR")}% OFF`
    : `${p.discount_value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} OFF`;
}

const hhmm = (t: string) => t.slice(0, 5);
const dayMonth = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: SP, day: "2-digit", month: "2-digit" });

/** "Seg, Sex · 18:00–22:00 · de 01/11 a 10/11" — vazio vira "Todos os dias, o dia todo". */
export function describeSchedule(p: Pick<Promotion, "weekdays" | "time_from" | "time_to" | "starts_at" | "ends_at">): string {
  const parts: string[] = [];
  parts.push(p.weekdays && p.weekdays.length > 0 ? p.weekdays.map((d) => WEEKDAY_LABELS[d]).join(", ") : "Todos os dias");
  parts.push(p.time_from && p.time_to ? `${hhmm(p.time_from)}–${hhmm(p.time_to)}` : "o dia todo");
  if (p.starts_at && p.ends_at) parts.push(`de ${dayMonth(p.starts_at)} a ${dayMonth(p.ends_at)}`);
  else if (p.starts_at) parts.push(`a partir de ${dayMonth(p.starts_at)}`);
  else if (p.ends_at) parts.push(`até ${dayMonth(p.ends_at)}`);
  return parts.join(" · ");
}

/** Situação para o selo da lista. A janela de horário/dia não entra: só o ciclo de vida (período). */
export function promotionStatus(p: Pick<Promotion, "is_active" | "starts_at" | "ends_at">, now: Date = new Date()): "off" | "scheduled" | "ended" | "on" {
  if (!p.is_active) return "off";
  if (p.starts_at && new Date(p.starts_at) > now) return "scheduled";
  if (p.ends_at && new Date(p.ends_at) <= now) return "ended";
  return "on";
}

/** Data (yyyy-mm-dd) no fuso de São Paulo, para preencher o <input type="date"> na edição. */
export function toDateInput(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: SP }) : "";
}

// ---------------------------------------------------------------------------
// Regra promoção x cupom (espelho de create_order: o MAIOR desconto vence; empate fica com o cupom)
// ---------------------------------------------------------------------------

export type AppliedDiscount =
  | { kind: "none"; amount: 0 }
  | { kind: "coupon"; amount: number }
  | { kind: "promotion"; amount: number; name: string };

export function pickBestDiscount(couponAmount: number, promotion: { name: string; amount: number } | null): AppliedDiscount {
  if (promotion && promotion.amount > couponAmount) return { kind: "promotion", amount: promotion.amount, name: promotion.name };
  if (couponAmount > 0) return { kind: "coupon", amount: couponAmount };
  return { kind: "none", amount: 0 };
}

/** Rótulo da linha de desconto de um pedido: "Cupom (X)" ou "Promoção Nome" (nome só existe quando o painel lê o pedido). */
export function discountLabel(order: { coupon_code: string | null; promotion_name?: string | null }): string {
  if (order.coupon_code) return `Cupom (${order.coupon_code})`;
  return order.promotion_name ? `Promoção ${order.promotion_name}` : "Promoção";
}
