import { requireMasterPage } from "@/lib/tenant";
import { getMasterAudit, parseAuditPage } from "@/lib/audit";
import { MasterAuditView } from "@/components/master/MasterAuditView";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page(props: PageProps<"/master/auditoria">) {
  const { supabase } = await requireMasterPage();

  const params = await props.searchParams;
  const page = parseAuditPage(params.pagina);
  // Só aceita um UUID de verdade no filtro (qualquer outra coisa é ignorada, nunca vai ao banco).
  const loja = typeof params.loja === "string" && UUID_PATTERN.test(params.loja) ? params.loja : null;

  const { rows, total } = await getMasterAudit(supabase, { page, restaurantId: loja });

  return <MasterAuditView rows={rows} total={total} page={page} restaurantId={loja} />;
}
