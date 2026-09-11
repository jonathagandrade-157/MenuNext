/**
 * Checklist de configuração da loja (painel) — calculado a partir do estado
 * REAL do restaurante a cada carregamento, nunca de um percentual salvo em
 * banco (`setup_progress` não existe e não deveria existir: se existisse,
 * ficaria dessincronizado assim que o lojista mudasse algo por fora do
 * checklist). `computeSetupItems` é pura e testável sem banco;
 * `getSetupChecklist` só busca os poucos números reais necessários
 * (contagens, nunca listas inteiras) e delega o cálculo a ela.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Restaurant } from "@/lib/tenant";

export type SetupItemId =
  | "informacoes"
  | "identidade"
  | "produtos"
  | "categorias"
  | "horarios"
  | "pagamentos"
  | "entrega"
  | "aparencia";

export type SetupItem = {
  id: SetupItemId;
  title: string;
  pendingDescription: string;
  completedDescription: string;
  actionLabel: string;
  actionHref: string;
  completed: boolean;
};

export type SetupChecklist = {
  items: SetupItem[];
  completedCount: number;
  totalCount: number;
  percent: number;
  isComplete: boolean;
};

export type SetupCounts = {
  activeProducts: number;
  activeCategories: number;
  openBusinessHours: number;
};

/**
 * Critérios de "concluído" (auditados contra o schema real, nada inventado):
 * - Informações da loja: endereço completo preenchido.
 * - Identidade: logo enviado (restaurants.logo_path).
 * - Produtos: pelo menos 1 produto disponível (is_available = true).
 * - Categorias: pelo menos 1 categoria ativa (is_active = true).
 * - Horários: pelo menos 1 dia com is_open = true em business_hours.
 * - Pagamentos: pelo menos uma forma aceita (payment_pix/cash/card).
 * - Entrega: retirada habilitada, OU delivery habilitado com taxa e raio definidos.
 * - Aparência: capa enviada (restaurants.cover_path).
 */
export function computeSetupItems(restaurant: Restaurant, counts: SetupCounts): SetupItem[] {
  const hasAddress = Boolean(
    restaurant.address_zip && restaurant.address_street && restaurant.address_city && restaurant.address_state
  );
  const hasPayment = restaurant.payment_pix || restaurant.payment_cash || restaurant.payment_card;
  const hasDelivery =
    restaurant.service_pickup ||
    (restaurant.service_delivery && restaurant.delivery_fee !== null && restaurant.delivery_radius_km !== null);

  return [
    {
      id: "informacoes",
      title: "Informações da loja",
      pendingDescription: "Complete o endereço do seu restaurante.",
      completedDescription: "Configuração concluída.",
      actionLabel: "Completar endereço",
      actionHref: "/onboarding/passo-2",
      completed: hasAddress,
    },
    {
      id: "identidade",
      title: "Identidade da loja",
      pendingDescription: "Adicione o logo da sua loja.",
      completedDescription: "Configuração concluída.",
      actionLabel: "Adicionar logo",
      actionHref: "/painel/aparencia",
      completed: restaurant.logo_path !== null,
    },
    {
      id: "produtos",
      title: "Produtos",
      pendingDescription: "Cadastre pelo menos um produto para vender.",
      completedDescription: "Você já cadastrou seus produtos.",
      actionLabel: "Adicionar produto",
      actionHref: "/painel/produtos/novo",
      completed: counts.activeProducts > 0,
    },
    {
      id: "categorias",
      title: "Categorias",
      pendingDescription: "Organize seus produtos em categorias.",
      completedDescription: "Configuração concluída.",
      actionLabel: "Criar categoria",
      actionHref: "/painel/categorias",
      completed: counts.activeCategories > 0,
    },
    {
      id: "horarios",
      title: "Horários",
      pendingDescription: "Defina os dias e horários de funcionamento.",
      completedDescription: "Configuração concluída.",
      actionLabel: "Configurar horários",
      actionHref: "/onboarding/passo-5",
      completed: counts.openBusinessHours > 0,
    },
    {
      id: "pagamentos",
      title: "Pagamentos",
      pendingDescription: "Escolha como seus clientes pagarão.",
      completedDescription: "Configuração concluída.",
      actionLabel: "Configurar pagamentos",
      actionHref: "/onboarding/passo-6",
      completed: hasPayment,
    },
    {
      id: "entrega",
      title: "Entrega",
      pendingDescription: "Defina como os clientes receberão os pedidos.",
      completedDescription: "Configuração concluída.",
      actionLabel: "Configurar entrega",
      actionHref: "/onboarding/passo-3",
      completed: hasDelivery,
    },
    {
      id: "aparencia",
      title: "Aparência",
      pendingDescription: "Personalize a capa da sua loja.",
      completedDescription: "Configuração concluída.",
      actionLabel: "Personalizar loja",
      actionHref: "/painel/aparencia",
      completed: restaurant.cover_path !== null,
    },
  ];
}

export function buildSetupChecklist(items: SetupItem[]): SetupChecklist {
  const completedCount = items.filter((item) => item.completed).length;
  const totalCount = items.length;
  return {
    items,
    completedCount,
    totalCount,
    percent: totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100),
    isComplete: completedCount === totalCount,
  };
}

/** Busca só as contagens necessárias (nunca listas inteiras) e monta o
 * checklist a partir do estado real do restaurante autenticado — RLS
 * (is_restaurant_member) já garante que só os dados do próprio tenant são
 * lidos; o `.eq("restaurant_id", ...)` aqui é defesa em profundidade, não a
 * proteção real. */
export async function getSetupChecklist(supabase: SupabaseClient, restaurant: Restaurant): Promise<SetupChecklist> {
  const [productsResult, categoriesResult, hoursResult] = await Promise.all([
    supabase.from("products").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurant.id).eq("is_available", true),
    supabase.from("categories").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurant.id).eq("is_active", true),
    supabase.from("business_hours").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurant.id).eq("is_open", true),
  ]);

  if (productsResult.error) throw productsResult.error;
  if (categoriesResult.error) throw categoriesResult.error;
  if (hoursResult.error) throw hoursResult.error;

  const counts: SetupCounts = {
    activeProducts: productsResult.count ?? 0,
    activeCategories: categoriesResult.count ?? 0,
    openBusinessHours: hoursResult.count ?? 0,
  };

  return buildSetupChecklist(computeSetupItems(restaurant, counts));
}
