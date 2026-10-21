import { redirect } from "next/navigation";
import { PanelSidebar, type NavGroup } from "@/components/layout/PanelSidebar";
import { getAuthedUser, isPlatformAdmin, resolvePostAuthPath } from "@/lib/tenant";

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { href: "/master", label: "Dashboard", icon: "dashboard" },
      { href: "/master/restaurantes", label: "Restaurantes", icon: "loja" },
      { href: "/master/assinaturas", label: "Assinaturas", icon: "assinaturas" },
    ],
  },
  {
    title: "Plataforma",
    items: [
      { href: "/master/metricas", label: "Métricas", icon: "metricas" },
      { href: "/master/usuarios", label: "Usuários", icon: "clientes" },
      { href: "/master/configuracoes", label: "Configurações", icon: "configuracoes" },
    ],
  },
  {
    title: "Operação",
    items: [
      { href: "/master/suporte", label: "Suporte", icon: "suporte" },
      { href: "/master/auditoria", label: "Auditoria", icon: "auditoria" },
    ],
  },
];

export default async function MasterLayout({ children }: { children: React.ReactNode }) {
  // Controle de acesso real (JON-9): antes só checava autenticação — agora
  // exige profiles.is_master = true (via RPC is_platform_admin, SECURITY
  // DEFINER). Quem não é admin da plataforma é mandado de volta para o
  // destino normal pós-login, sem ver nem o esqueleto do /master.
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const isAdmin = await isPlatformAdmin(supabase);
  if (!isAdmin) redirect(await resolvePostAuthPath(supabase));

  return (
    <div className="flex min-h-screen flex-col bg-surface lg:flex-row">
      <PanelSidebar brandLabel="Painel Master" groups={NAV_GROUPS} />
      <div className="flex-1">{children}</div>
    </div>
  );
}
