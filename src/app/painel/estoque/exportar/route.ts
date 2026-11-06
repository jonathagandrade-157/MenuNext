import { getAuthedUser, getMyMembership, getMyRestaurant } from "@/lib/tenant";
import { parseReportPeriod } from "@/lib/reports";
import { computeStockReport, getStockReportData, stockReportToCsv } from "@/lib/stockReport";

/** CSV do relatório de estoque. Só OWNER da própria loja (a loja vem da sessão, nunca da URL). */
export async function GET(request: Request) {
  const { supabase, user } = await getAuthedUser();
  if (!user) return new Response("Não autenticado.", { status: 401 });
  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) return new Response("Sem loja.", { status: 403 });
  const membership = await getMyMembership(supabase, restaurant.id);
  if (membership?.role !== "OWNER") return new Response("Apenas o proprietário pode exportar.", { status: 403 });

  const url = new URL(request.url);
  const parsed = parseReportPeriod(url.searchParams.get("from"), url.searchParams.get("to"));
  if (!parsed.ok) return new Response(parsed.error, { status: 400 });

  const data = await getStockReportData(supabase, restaurant.id, parsed.period);
  const report = computeStockReport(data.products, data.ledger, parsed.period.startIso, parsed.period.endIso, data.thresholds);
  return new Response(stockReportToCsv(report.rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="estoque-${parsed.period.from}_a_${parsed.period.to}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Report-Truncated": data.truncated ? "1" : "0",
    },
  });
}
