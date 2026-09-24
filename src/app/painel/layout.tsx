import { redirect } from "next/navigation";
import { PanelSidebar, type NavGroup } from "@/components/layout/PanelSidebar";
import { PanelTopbar } from "@/components/layout/PanelTopbar";
import { getAuthedUser, getMyRestaurant, getMyMembership } from "@/lib/tenant";

// ownerOnly (JON-10): STAFF (convidado via JON-27) só vê o operacional do
// dia a dia + cardápio — administração da loja, relacionamento e conta
// ficam restritas ao OWNER. As páginas correspondentes também aplicam
// requireOwnerPage() (defesa em profundidade — esconder o link não basta).
const ALL_NAV_GROUPS: NavGroup[] = [
  {
    title: "Operação",
    items: [
      { href: "/painel", label: "Dashboard" },
      { href: "/painel/pedidos", label: "Pedidos" },
      { href: "/painel/caixa", label: "Frente de Caixa" },
      { href: "/painel/kds", label: "Cozinha (KDS)" },
    ],
  },
  {
    title: "Cardápio",
    items: [
      { href: "/painel/categorias", label: "Categorias" },
      { href: "/painel/produtos", label: "Produtos" },
      { href: "/painel/adicionais", label: "Adicionais" },
      { href: "/painel/combos", label: "Combos" },
    ],
  },
  {
    title: "Loja",
    items: [
      { href: "/painel/informacoes", label: "Informações", ownerOnly: true },
      { href: "/painel/delivery", label: "Delivery", ownerOnly: true },
      { href: "/painel/horarios", label: "Horários", ownerOnly: true },
      { href: "/painel/pagamentos", label: "Pagamentos", ownerOnly: true },
      { href: "/painel/aparencia", label: "Aparência", ownerOnly: true },
    ],
  },
  {
    title: "Relacionamento",
    items: [
      { href: "/painel/clientes", label: "Clientes", ownerOnly: true },
      { href: "/painel/marketing", label: "Marketing", ownerOnly: true },
    ],
  },
  {
    title: "Conta",
    items: [
      { href: "/painel/usuarios", label: "Usuários", ownerOnly: true },
      { href: "/painel/configuracoes", label: "Configurações", ownerOnly: true },
      { href: "/painel/plano", label: "Plano", ownerOnly: true },
      { href: "/painel/ajuda", label: "Ajuda" },
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

  const navGroups: NavGroup[] = isOwner
    ? ALL_NAV_GROUPS
    : ALL_NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => !item.ownerOnly) })).filter(
        (group) => group.items.length > 0
      );

  return (
    <div className="flex min-h-screen flex-col bg-surface lg:flex-row">
      <PanelSidebar brandLabel="Painel do Lojista" groups={navGroups} />
      <div className="flex flex-1 flex-col">
        <PanelTopbar storeName={restaurant.name} storeSlug={restaurant.slug} isOpen={restaurant.status === "active"} />
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
