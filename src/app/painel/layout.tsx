import { PanelSidebar, type NavGroup } from "@/components/layout/PanelSidebar";
import { PanelTopbar } from "@/components/layout/PanelTopbar";

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

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-surface">
      <PanelSidebar brandLabel="Painel do Lojista" groups={NAV_GROUPS} />
      <div className="flex flex-1 flex-col">
        <PanelTopbar storeName="Next Burger Artesanal" storeSlug="next-burger" isOpen />
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
