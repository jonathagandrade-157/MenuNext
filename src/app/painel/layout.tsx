import { redirect } from "next/navigation";
import { PanelMobileNav, PanelSideNav, type NavGroup } from "@/components/layout/PanelSidebar";
import { PanelTopbar } from "@/components/layout/PanelTopbar";
import { SubscriptionGate } from "@/components/painel/SubscriptionGate";
import { getPublicAssetUrl } from "@/lib/storage/assets";
import { getAuthedUser, getMyAccessState, getMyRestaurant, getMyMembership } from "@/lib/tenant";

// ownerOnly (JON-10, P1-02): STAFF (convidado via JON-27) só vê o operacional
// do dia a dia e, no cardápio, Produtos e Adicionais SOMENTE para ligar/desligar
// a disponibilidade. Administração da loja, categorias, combos, relacionamento
// e conta ficam restritas ao OWNER. As páginas aplicam requireOwnerPage(), as
// Server Actions aplicam requireOwnerAction() e o banco recusa a escrita
// (RLS por papel + triggers): esconder o link não basta.
const ALL_NAV_GROUPS: NavGroup[] = [
  {
    title: "Operação",
    items: [
      { href: "/painel", label: "Dashboard", icon: "dashboard" },
      { href: "/painel/pedidos", label: "Pedidos", icon: "pedidos" },
      { href: "/painel/caixa", label: "Frente de Caixa", icon: "caixa" },
      { href: "/painel/kds", label: "Cozinha (KDS)", icon: "kds" },
    ],
  },
  {
    title: "Cardápio",
    items: [
      { href: "/painel/categorias", label: "Categorias", icon: "categorias", ownerOnly: true },
      { href: "/painel/produtos", label: "Produtos", icon: "produtos" },
      { href: "/painel/adicionais", label: "Adicionais", icon: "adicionais" },
      { href: "/painel/combos", label: "Combos", icon: "combos", ownerOnly: true },
    ],
  },
  {
    title: "Loja",
    items: [
      { href: "/painel/informacoes", label: "Informações", icon: "loja", ownerOnly: true },
      { href: "/painel/delivery", label: "Delivery", icon: "delivery", ownerOnly: true },
      { href: "/painel/horarios", label: "Horários", icon: "horarios", ownerOnly: true },
      { href: "/painel/pagamentos", label: "Pagamentos", icon: "pagamentos", ownerOnly: true },
      { href: "/painel/aparencia", label: "Aparência", icon: "aparencia", ownerOnly: true },
    ],
  },
  {
    title: "Relacionamento",
    items: [
      { href: "/painel/clientes", label: "Clientes", icon: "clientes", ownerOnly: true },
      { href: "/painel/marketing", label: "Marketing", icon: "marketing", ownerOnly: true },
    ],
  },
  {
    title: "Conta",
    items: [
      { href: "/painel/usuarios", label: "Usuários", icon: "usuarios", ownerOnly: true },
      { href: "/painel/configuracoes", label: "Configurações", icon: "configuracoes", ownerOnly: true },
      { href: "/painel/plano", label: "Plano", icon: "plano", ownerOnly: true },
      { href: "/painel/ajuda", label: "Ajuda", icon: "ajuda" },
    ],
  },
];

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  // Checagem autoritativa (não apenas o proxy): sem sessão ou sem
  // restaurante, o usuário não acessa o painel de verdade. Onboarding
  // incompleto NÃO bloqueia mais o acesso — o onboarding é um guia
  // opcional; o painel (com o checklist de configuração) é onde o lojista
  // completa a loja no próprio ritmo. Ver reestruturação do onboarding.
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const membership = await getMyMembership(supabase, restaurant.id);
  const isOwner = membership?.role === "OWNER";

  // Contador do menu: pedidos novos (colunas "Novos" do Kanban), dado real.
  // Sem contador se a consulta falhar — o menu não pode quebrar por isso.
  const { count: newOrders } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurant.id)
    .in("status", ["received", "confirmed"]);

  const withBadges: NavGroup[] = ALL_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.map((item) =>
      item.href === "/painel/pedidos" && newOrders ? { ...item, badge: newOrders } : item
    ),
  }));

  const navGroups: NavGroup[] = isOwner
    ? withBadges
    : withBadges.map((group) => ({ ...group, items: group.items.filter((item) => !item.ownerOnly) })).filter(
        (group) => group.items.length > 0
      );

  const accessState = await getMyAccessState(supabase);

  const rawName = user.user_metadata?.name;
  const userName = typeof rawName === "string" && rawName.trim() ? rawName.trim() : null;
  const storeLocation = [restaurant.address_city, restaurant.address_state].filter(Boolean).join(", ") || null;
  const logoUrl = restaurant.logo_path ? getPublicAssetUrl(supabase, restaurant.logo_path) : null;

  return (
    <div className="min-h-screen bg-surface">
      <SubscriptionGate accessState={accessState} isOwner={isOwner}>
        <PanelMobileNav brandLabel="Painel do Lojista" groups={navGroups} />
        <PanelTopbar
          storeName={restaurant.name}
          storeSlug={restaurant.slug}
          storeLocation={storeLocation}
          logoUrl={logoUrl}
          isOpen={restaurant.status === "active"}
          userName={userName}
          roleLabel={isOwner ? "Proprietário" : "Equipe"}
        />
        <div className="mx-auto flex w-full max-w-[1440px]">
          <PanelSideNav groups={navGroups} />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </SubscriptionGate>
    </div>
  );
}
