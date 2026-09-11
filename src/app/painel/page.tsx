import { redirect } from "next/navigation";
import { getAuthedUser, getMyRestaurant, getMyMembership } from "@/lib/tenant";
import { formatCurrencyBRL, getDashboardOrderMetrics } from "@/lib/orders";
import { getSetupChecklist } from "@/lib/setup";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SetupChecklistCard } from "@/components/painel/SetupChecklistCard";

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  active: "Ativo",
  paused: "Pausado",
  closed: "Encerrado",
};

export default async function PainelDashboardPage() {
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const membership = await getMyMembership(supabase, restaurant.id);
  const [metrics, checklist] = await Promise.all([
    getDashboardOrderMetrics(supabase, restaurant.id),
    getSetupChecklist(supabase, restaurant),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-extrabold text-graphite">Olá, bem-vindo ao {restaurant.name}</h1>
      <p className="mt-1 text-sm text-text-muted">Aqui está o resumo real da operação de hoje.</p>

      <div className="mt-6">
        <SetupChecklistCard checklist={checklist} storeSlug={restaurant.slug} />
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Pedidos hoje</p>
          <p className="mt-1 text-2xl font-extrabold text-graphite">{metrics.ordersToday}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Faturamento hoje</p>
          <p className="mt-1 text-2xl font-extrabold text-graphite">{formatCurrencyBRL(metrics.revenueToday)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Ticket médio</p>
          <p className="mt-1 text-2xl font-extrabold text-graphite">{formatCurrencyBRL(metrics.averageTicketToday)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Pedidos ativos</p>
          <p className="mt-1 text-2xl font-extrabold text-graphite">{metrics.activeOrders}</p>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Usuário</p>
          <p className="mt-1 text-sm font-semibold text-graphite">{user.email}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Seu papel</p>
          <p className="mt-1 text-sm font-semibold text-graphite">{membership?.role ?? "—"}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Status da loja</p>
          <Badge tone={restaurant.status === "active" ? "success" : "neutral"} className="mt-1">
            {STATUS_LABEL[restaurant.status] ?? restaurant.status}
          </Badge>
        </Card>
      </div>

      <Card className="mt-6 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Endereço da loja</p>
        <p className="mt-1 text-sm text-graphite">menunext.com.br/{restaurant.slug}</p>
      </Card>
    </div>
  );
}
