import { assertMasterMfa, assertMasterNetwork } from "@/lib/masterGuard";
import { redirect } from "next/navigation";
import { PanelSidebar, type NavGroup } from "@/components/layout/PanelSidebar";
import { getAuthedUser, resolveMasterAccess, resolvePostAuthPath } from "@/lib/tenant";
import { MASTER_MFA_PATH } from "@/lib/masterAccess";

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
  await assertMasterNetwork(); // MASTER_HOST / MASTER_ALLOWED_IPS: fora da rede permitida, 404
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const access = await resolveMasterAccess(supabase);
  if (access === "not_admin") redirect(await resolvePostAuthPath(supabase));
  if (access === "mfa_required") redirect(MASTER_MFA_PATH); // exigência de AAL2 ligada no banco
  await assertMasterMfa(supabase); // MASTER_REQUIRE_MFA=true: exige o segundo fator

  return (
    <div className="flex min-h-screen flex-col bg-surface lg:flex-row">
      <PanelSidebar brandLabel="Painel Master" groups={NAV_GROUPS} homeHref="/master" />
      <div className="flex-1">{children}</div>
    </div>
  );
}
