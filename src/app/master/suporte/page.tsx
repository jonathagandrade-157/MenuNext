import { requireMasterPage } from "@/lib/tenant";
import { getAdminTickets, getTicketMessages, isTicketId, type TicketStatus } from "@/lib/support";
import { SupportDesk } from "@/components/support/SupportDesk";
import { EmptyState } from "@/components/ui/States";

const STATUSES: TicketStatus[] = ["open", "waiting_customer", "resolved", "closed"];

export default async function Page(props: PageProps<"/master/suporte">) {
  const { supabase } = await requireMasterPage();
  const params = await props.searchParams;
  const status = typeof params.status === "string" && STATUSES.includes(params.status as TicketStatus) ? (params.status as TicketStatus) : null;
  const { available, tickets } = await getAdminTickets(supabase, status);
  const wanted = typeof params.chamado === "string" && isTicketId(params.chamado) ? params.chamado : null;
  const selected = tickets.find((t) => t.id === wanted) ?? null;
  const messages = selected ? await getTicketMessages(supabase, selected.id) : [];

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-headline-lg text-graphite">Suporte</h1>
        <p className="mt-0.5 text-body-md text-text-muted">Fila de atendimento dos lojistas, por prioridade.</p>
      </div>
      {available ? (
        <SupportDesk mode="master" basePath="/master/suporte" tickets={tickets} selected={selected} messages={messages} statusFilter={status} />
      ) : (
        <EmptyState title="Chamados indisponíveis neste ambiente." description="A migration de suporte ainda não foi aplicada." />
      )}
    </div>
  );
}
