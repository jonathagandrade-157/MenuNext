import { PanelSidebar, type NavGroup } from "@/components/layout/PanelSidebar";

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { href: "/master", label: "Dashboard" },
      { href: "/master/restaurantes", label: "Restaurantes" },
      { href: "/master/assinaturas", label: "Assinaturas" },
    ],
  },
  {
    title: "Plataforma",
    items: [
      { href: "/master/metricas", label: "Métricas" },
      { href: "/master/usuarios", label: "Usuários" },
      { href: "/master/configuracoes", label: "Configurações" },
    ],
  },
  {
    title: "Operação",
    items: [
      { href: "/master/suporte", label: "Suporte" },
      { href: "/master/auditoria", label: "Auditoria" },
    ],
  },
];

export default function MasterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-surface">
      <PanelSidebar brandLabel="Painel Master" groups={NAV_GROUPS} />
      <div className="flex-1">{children}</div>
    </div>
  );
}
