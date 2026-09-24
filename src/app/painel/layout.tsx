import { redirect } from "next/navigation";
import { PanelSidebar, type NavGroup } from "@/components/layout/PanelSidebar";
import { PanelTopbar } from "@/components/layout/PanelTopbar";
import { getAuthedUser, getMyRestaurant } from "@/lib/tenant";

const NAV_GROUPS: NavGroup[] = [
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
      { href: "/painel/informacoes", label: "Informações" },
      { href: "/painel/delivery", label: "Delivery" },
      { href: "/painel/horarios", label: "Horários" },
      { href: "/painel/pagamentos", label: "Pagamentos" },
      { href: "/painel/aparencia", label: "Aparência" },
    ],
  },
  {
    title: "Relacionamento",
    items: [
      { href: "/painel/clientes", label: "Clientes" },
      { href: "/painel/marketing", label: "Marketing" },
    ],
  },
  {
    title: "Conta",
    items: [
      { href: "/painel/usuarios", label: "Usuários" },
      { href: "/painel/configuracoes", label: "Configurações" },
      { href: "/painel/plano", label: "Plano" },
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

  return (
    <div className="flex min-h-screen flex-col bg-surface lg:flex-row">
      <PanelSidebar brandLabel="Painel do Lojista" groups={NAV_GROUPS} />
      <div className="flex flex-1 flex-col">
        <PanelTopbar storeName={restaurant.name} storeSlug={restaurant.slug} isOpen={restaurant.status === "active"} />
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
