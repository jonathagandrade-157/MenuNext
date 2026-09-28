import Link from "next/link";
import { requireOwnerPage } from "@/lib/tenant";
import { getRecentOrders } from "@/lib/orders";
import { getStoreUrl } from "@/lib/site-url";
import { Card } from "@/components/ui/Card";
import { StoreStatusCard } from "@/components/painel/configuracoes/StoreStatusCard";
import { ContactInfoForm } from "@/components/painel/configuracoes/ContactInfoForm";
import { StoreShareCard } from "@/components/painel/dashboard/StoreShareCard";

/**
 * Configurações gerais (redesign Stitch, área "Configurações Gerais") —
 * nome do restaurante e endereço já são editáveis em /painel/informacoes
 * (linkado abaixo, não duplicado aqui). Pausar/reabrir a loja
 * (restaurants.status) e o link/QR Code (StoreShareCard, já construído
 * para o Dashboard) são reaproveitados sem duplicar. Contato
 * (WhatsApp/e-mail) e bio são o gap real desta tela (ContactInfoForm).
 *
 * Fora de escopo, decidido com o usuário: toggle para desligar a checagem
 * de horário de funcionamento no checkout (create_order já a aplica
 * sempre — expor um jeito de desligá-la seria um risco de produto sem
 * pedido claro para isso) e "Dados da Conta MenuNext"/billing (bloqueado,
 * mesma decisão de Caixa/Plano).
 */
export default async function ConfiguracoesPage() {
  const { supabase, restaurant } = await requireOwnerPage();

  const [recentOrders, storeUrl] = await Promise.all([
    getRecentOrders(supabase, restaurant.id, 1),
    getStoreUrl(restaurant.slug),
  ]);

  // draft/closed não são estados que este toggle sabe reverter (draft ainda
  // nem terminou o onboarding; closed não é exposto ao lojista) — mostra um
  // aviso neutro em vez de uma ação que a Server Action rejeitaria.
  const canToggleStatus = restaurant.status === "active" || restaurant.status === "paused";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-graphite">Configurações gerais</h1>
        <p className="mt-0.5 text-sm font-medium text-text-muted">Status da loja, contato, bio e link público de divulgação.</p>
      </div>

      {canToggleStatus ? (
        <StoreStatusCard initialStatus={restaurant.status === "paused" ? "paused" : "active"} />
      ) : (
        <Card className="p-6">
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-text-muted">Status da loja</h2>
          <p className="mt-1 text-sm text-text-muted">
            Finalize o cadastro da sua loja para poder pausar ou reabrir o recebimento de pedidos por aqui.
          </p>
        </Card>
      )}

      <Card className="p-6">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-text-muted">Nome e endereço</h2>
        <p className="mt-1 text-sm text-text-muted">
          Nome do restaurante, URL da loja e endereço completo ficam em Informações do restaurante.
        </p>
        <Link href="/painel/informacoes" className="mt-2 inline-block text-sm font-semibold text-primary hover:underline">
          Editar informações do restaurante →
        </Link>
      </Card>

      <ContactInfoForm restaurant={restaurant} />

      <StoreShareCard
        storeUrl={storeUrl}
        storeName={restaurant.name}
        isActive={restaurant.status === "active"}
        hasAnyOrder={recentOrders.length > 0}
      />
    </div>
  );
}
