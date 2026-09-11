import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPublicOrder, getPublicRestaurantBySlug } from "@/lib/store";
import type { OrderStatus } from "@/lib/orders";
import { OrderTrackingProgress } from "@/components/loja/OrderTrackingProgress";
import { StoreNotFound } from "@/components/loja/StoreNotFound";

export default async function Page({ params }: PageProps<"/loja/[slug]/pedido/[orderId]/rastreamento">) {
  const { slug, orderId } = await params;
  const supabase = await createClient();

  const restaurant = await getPublicRestaurantBySlug(supabase, slug);
  if (!restaurant) return <StoreNotFound />;

  const order = await getPublicOrder(supabase, slug, orderId);
  if (!order) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="rounded-full bg-surface-subdued px-3 py-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
          Pedido não encontrado
        </span>
        <h1 className="text-xl font-extrabold text-graphite">Não encontramos esse pedido</h1>
        <p className="max-w-xs text-sm text-text-muted">O link pode estar incorreto ou o pedido pertence a outra loja.</p>
        <Link href={`/loja/${slug}`} className="text-sm font-semibold text-primary hover:underline">
          ← Voltar para o cardápio
        </Link>
      </div>
    );
  }

  return (
    <div className="pb-10">
      <div className="sticky top-0 z-20 flex items-center gap-2 bg-surface-card/95 px-3.5 py-3 backdrop-blur-md">
        <Link
          href={`/loja/${slug}/pedido/${order.public_id}`}
          aria-label="Voltar para o pedido"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-graphite hover:bg-surface-subdued"
        >
          ←
        </Link>
        <span className="text-sm font-bold text-graphite">Pedido #{order.order_number}</span>
      </div>

      <div className="px-4 py-6">
        <p className="mb-6 text-sm text-text-muted">
          Acompanhe abaixo o andamento do seu pedido em {order.restaurant_name}. A tela atualiza sozinha conforme o
          restaurante avança o preparo.
        </p>
        <OrderTrackingProgress
          publicId={order.public_id}
          initialStatus={order.status as OrderStatus}
          fulfillmentType={order.fulfillment_type}
        />
      </div>
    </div>
  );
}
