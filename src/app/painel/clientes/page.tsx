import { requireOwnerPage } from "@/lib/tenant";
import { aggregateCustomers, getCustomerNotesByPhone, getCustomerOrders } from "@/lib/customers";
import { ClientesView } from "@/components/painel/clientes/ClientesView";

// Restrita ao OWNER (JON-10): fora do escopo operacional/cardápio.
export default async function Page() {
  const { supabase, restaurant } = await requireOwnerPage();

  const [orders, notesByPhone] = await Promise.all([
    getCustomerOrders(supabase, restaurant.id),
    getCustomerNotesByPhone(supabase, restaurant.id),
  ]);
  const customers = aggregateCustomers(orders);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-graphite">Clientes</h1>
        <p className="mt-0.5 text-sm font-medium text-text-muted">
          Todos os clientes que já fizeram pedidos, com histórico e totais.
        </p>
      </div>

      <ClientesView customers={customers} notesByPhone={notesByPhone} now={new Date().toISOString()} />
    </div>
  );
}
