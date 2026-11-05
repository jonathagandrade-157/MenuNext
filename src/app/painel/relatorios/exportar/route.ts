import { getAuthedUser, getMyMembership, getMyRestaurant } from "@/lib/tenant";
import { getReportOrders, ordersToCsv, parseReportPeriod } from "@/lib/reports";

/**
 * Exportação CSV dos pedidos do período. Só OWNER da própria loja: a loja vem da sessão (nunca da URL), a leitura
 * passa pela RLS e o arquivo não leva nome nem telefone de clientes. Sem sessão/papel: 401/403 sem corpo útil.
 */
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

  const { rows, truncated } = await getReportOrders(supabase, restaurant.id, parsed.period);
  const filename = `pedidos-${parsed.period.from}_a_${parsed.period.to}.csv`;
  return new Response(ordersToCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Report-Truncated": truncated ? "1" : "0",
    },
  });
}
