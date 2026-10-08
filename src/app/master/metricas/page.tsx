import { requireMasterPage } from "@/lib/tenant";
import { getMasterMetrics, parsePeriod } from "@/lib/masterMetrics";
import { MasterMetricsView } from "@/components/master/MasterMetricsView";

export default async function Page(props: PageProps<"/master/metricas">) {
  const { supabase } = await requireMasterPage();

  const period = parsePeriod((await props.searchParams).dias);
  const metrics = await getMasterMetrics(supabase, period);

  return <MasterMetricsView metrics={metrics} period={period} />;
}
