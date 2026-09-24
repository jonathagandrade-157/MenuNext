import { redirect } from "next/navigation";
import { PanelSidebar, type NavGroup } from "@/components/layout/PanelSidebar";
import { getAuthedUser } from "@/lib/tenant";

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

export default async function MasterLayout({ children }: { children: React.ReactNode }) {
  // Checagem autoritativa de autenticação apenas. Este Sprint não implementa
  // o papel MASTER de verdade (não existe esse conceito no schema ainda) —
  // ver relatório da Sprint 1 para o que falta antes de considerar isto seguro.
  const { user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  return (
    <div className="flex min-h-screen flex-col bg-surface lg:flex-row">
      <PanelSidebar brandLabel="Painel Master" groups={NAV_GROUPS} />
      <div className="flex-1">{children}</div>
    </div>
  );
}
