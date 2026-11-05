import { requireOwnerPage } from "@/lib/tenant";
import { getMerchantTickets, getTicketMessages, isTicketId } from "@/lib/support";
import { SupportDesk } from "@/components/support/SupportDesk";
import { EmptyState } from "@/components/ui/States";

// Chamados são do OWNER (STAFF volta para /painel). A RLS também limita ao dono da loja.
export default async function SuportePage(props: PageProps<"/painel/suporte">) {
  const { supabase, restaurant } = await requireOwnerPage();
  const params = await props.searchParams;
  const { available, tickets } = await getMerchantTickets(supabase, restaurant.id);
  const wanted = typeof params.chamado === "string" && isTicketId(params.chamado) ? params.chamado : null;
  const selected = tickets.find((t) => t.id === wanted) ?? null;
  const messages = selected ? await getTicketMessages(supabase, selected.id) : [];

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-headline-lg text-graphite">Suporte</h1>
        <p className="mt-0.5 text-body-md text-text-muted">Abra chamados e acompanhe o atendimento. Não envie senhas nem dados de cartão.</p>
      </div>
      {available ? (
        <SupportDesk mode="merchant" basePath="/painel/suporte" tickets={tickets} selected={selected} messages={messages} />
      ) : (
        <EmptyState title="Chamados indisponíveis neste ambiente." description="Use os contatos da página Ajuda enquanto isso." />
      )}
    </div>
  );
}
