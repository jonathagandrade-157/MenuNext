import type { SupabaseClient } from "@supabase/supabase-js";

export type SubscriptionStatus = "active" | "pending" | "overdue" | "cancelled";
export type RestaurantStatus = "draft" | "active" | "paused" | "closed";

export const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ["active", "pending", "overdue", "cancelled"];

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export const SUBSCRIPTION_STATUS_BADGE: Record<SubscriptionStatus, { label: string; tone: Tone }> = {
  active: { label: "Em dia", tone: "success" },
  pending: { label: "Aguardando 1º pagamento", tone: "warning" },
  overdue: { label: "Atrasada", tone: "danger" },
  cancelled: { label: "Cancelada", tone: "neutral" },
};

export const RESTAURANT_STATUS_BADGE: Record<RestaurantStatus, { label: string; tone: Tone }> = {
  draft: { label: "Em configuração", tone: "warning" },
  active: { label: "Ativo", tone: "success" },
  paused: { label: "Pausado", tone: "neutral" },
  closed: { label: "Encerrado", tone: "danger" },
};

export const LIST_PAGE_SIZE = 25;

export type MasterRestaurantRow = {
  id: string;
  name: string;
  slug: string;
  status: RestaurantStatus;
  onboarding_completed: boolean;
  created_at: string;
  plan_name: string | null;
  plan_price: number | null;
  subscription_status: SubscriptionStatus;
  orders_total: number;
  last_order_at: string | null;
};

export type MasterRestaurantDetail = {
  id: string;
  name: string;
  slug: string;
  status: RestaurantStatus;
  onboarding_completed: boolean;
  onboarding_step: number;
  created_at: string;
  contact_whatsapp: string | null;
  contact_email: string | null;
  plan_name: string | null;
  plan_price: number | null;
  subscription_status: SubscriptionStatus;
  owner_name: string | null;
  owner_email: string | null;
  orders_total: number;
  orders_today: number;
  orders_month: number;
  orders_completed: number;
  orders_cancelled: number;
  customers_unique: number;
  first_order_at: string | null;
  last_order_at: string | null;
  products_count: number;
  open_business_days: number;
};

export type MasterListParams = {
  search: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  page: number;
};

type RawSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Lê a query string da lista sem confiar nela: busca aparada e limitada,
 * status só entre os valores conhecidos, página sempre um inteiro >= 1. */
export function parseListParams(raw: RawSearchParams): MasterListParams {
  const search = firstValue(raw.q)?.trim().slice(0, 80) || null;

  const rawStatus = firstValue(raw.status);
  const subscriptionStatus = SUBSCRIPTION_STATUSES.find((s) => s === rawStatus) ?? null;

  const rawPage = Number.parseInt(firstValue(raw.page) ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;

  return { search, subscriptionStatus, page };
}

export function buildListHref(params: MasterListParams): string {
  const query = new URLSearchParams();
  if (params.search) query.set("q", params.search);
  if (params.subscriptionStatus) query.set("status", params.subscriptionStatus);
  if (params.page > 1) query.set("page", String(params.page));
  const qs = query.toString();
  return qs ? `/master/restaurantes?${qs}` : "/master/restaurantes";
}

/** Receita recorrente do restaurante: o valor do plano enquanto a assinatura
 * está em dia. Pendente, atrasada ou cancelada não contam como receita. */
export function computeMrr(planPrice: number | null, status: SubscriptionStatus): number {
  if (planPrice === null || status !== "active") return 0;
  return planPrice;
}

/** Entregues/retirados sobre os pedidos já encerrados (concluídos +
 * cancelados), em %, com uma casa decimal. Pedidos ainda em andamento ficam
 * de fora; sem nenhum pedido encerrado não há taxa (null, nunca 0%/100%). */
export function computeCompletionRate(completed: number, cancelled: number): number | null {
  const finished = completed + cancelled;
  if (finished === 0) return null;
  return Math.round((completed / finished) * 1000) / 10;
}

export type ActivationStep = { id: string; label: string; done: boolean; date: string | null };

/** Etapas de ativação derivadas de fatos reais do banco — nenhuma etapa é
 * marcada por palpite. Só "conta criada" e "primeiro pedido" têm data. */
export function buildActivationSteps(detail: MasterRestaurantDetail): ActivationStep[] {
  return [
    { id: "account", label: "Conta criada", done: true, date: detail.created_at },
    {
      id: "onboarding",
      label: detail.onboarding_completed ? "Onboarding concluído" : `Onboarding em andamento (passo ${detail.onboarding_step} de 7)`,
      done: detail.onboarding_completed,
      date: null,
    },
    { id: "menu", label: "Cardápio com produtos", done: detail.products_count > 0, date: null },
    { id: "hours", label: "Horários de funcionamento definidos", done: detail.open_business_days > 0, date: null },
    {
      id: "published",
      label: "Loja publicada",
      done: detail.onboarding_completed && detail.status === "active",
      date: null,
    },
    { id: "first_order", label: "Primeiro pedido recebido", done: detail.first_order_at !== null, date: detail.first_order_at },
  ];
}

export function computeActivationProgress(steps: ActivationStep[]): { done: number; total: number; percent: number } {
  const done = steps.filter((s) => s.done).length;
  return { done, total: steps.length, percent: steps.length === 0 ? 0 : Math.round((done / steps.length) * 100) };
}

// Fuso fixo: o servidor pode rodar em UTC, e o produto é operado em horário
// de Brasília (mesmo critério de "hoje"/"mês" usado nas RPCs do master).
export function formatDateTimeBR(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTimeBR(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}

export function formatDateBR(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

type RawRow = Record<string, unknown>;

function toNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export async function getMasterRestaurants(
  supabase: SupabaseClient,
  params: MasterListParams
): Promise<{ rows: MasterRestaurantRow[]; total: number }> {
  const { data, error } = await supabase.rpc("master_list_restaurants", {
    p_search: params.search,
    p_subscription_status: params.subscriptionStatus,
    p_limit: LIST_PAGE_SIZE,
    p_offset: (params.page - 1) * LIST_PAGE_SIZE,
  });
  if (error) throw error;

  const raw = (data ?? []) as RawRow[];
  const rows = raw.map(
    (row): MasterRestaurantRow => ({
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      status: row.status as RestaurantStatus,
      onboarding_completed: row.onboarding_completed as boolean,
      created_at: row.created_at as string,
      plan_name: (row.plan_name as string | null) ?? null,
      plan_price: toNumberOrNull(row.plan_price),
      subscription_status: row.subscription_status as SubscriptionStatus,
      orders_total: Number(row.orders_total),
      last_order_at: (row.last_order_at as string | null) ?? null,
    })
  );
  const total = raw.length > 0 ? Number(raw[0].total_count) : 0;
  return { rows, total };
}

export async function getMasterRestaurant(
  supabase: SupabaseClient,
  restaurantId: string
): Promise<MasterRestaurantDetail | null> {
  const { data, error } = await supabase.rpc("master_get_restaurant", { p_restaurant_id: restaurantId });
  if (error) throw error;

  const row = ((data ?? []) as RawRow[])[0];
  if (!row) return null;

  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    status: row.status as RestaurantStatus,
    onboarding_completed: row.onboarding_completed as boolean,
    onboarding_step: Number(row.onboarding_step),
    created_at: row.created_at as string,
    contact_whatsapp: (row.contact_whatsapp as string | null) ?? null,
    contact_email: (row.contact_email as string | null) ?? null,
    plan_name: (row.plan_name as string | null) ?? null,
    plan_price: toNumberOrNull(row.plan_price),
    subscription_status: row.subscription_status as SubscriptionStatus,
    owner_name: (row.owner_name as string | null) ?? null,
    owner_email: (row.owner_email as string | null) ?? null,
    orders_total: Number(row.orders_total),
    orders_today: Number(row.orders_today),
    orders_month: Number(row.orders_month),
    orders_completed: Number(row.orders_completed),
    orders_cancelled: Number(row.orders_cancelled),
    customers_unique: Number(row.customers_unique),
    first_order_at: (row.first_order_at as string | null) ?? null,
    last_order_at: (row.last_order_at as string | null) ?? null,
    products_count: Number(row.products_count),
    open_business_days: Number(row.open_business_days),
  };
}
