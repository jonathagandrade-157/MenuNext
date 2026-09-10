import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPublicOrder, getPublicRestaurantBySlug, formatCurrencyBRL } from "@/lib/store";
import { ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/checkout";
import { CopyButton } from "@/components/loja/CopyButton";
import { StoreNotFound } from "@/components/loja/StoreNotFound";

const FULFILLMENT_LABEL: Record<string, string> = { delivery: "Entrega", pickup: "Retirada" };

export default async function Page({ params }: PageProps<"/loja/[slug]/pedido/[orderId]">) {
  const { slug, orderId } = await params;
  const supabase = await createClient();

  const restaurant = await getPublicRestaurantBySlug(supabase, slug);
  if (!restaurant) return <StoreNotFound />;

  // `orderId` na URL é o public_id (UUID não sequencial) — get_public_order
  // amarra slug + public_id ao mesmo tempo, nunca devolvendo pedido de
  // outro restaurante mesmo que o id "pareça" válido.
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
      <div className="flex flex-col items-center gap-2 bg-emerald/10 px-3.5 py-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald text-2xl text-white">✓</span>
        <h1 className="text-lg font-extrabold text-graphite">Pedido recebido!</h1>
        <p className="text-sm text-text-muted">Pedido #{order.order_number} em {order.restaurant_name}</p>
        <span className="mt-1 rounded-full border border-emerald/20 bg-surface-card px-3 py-1 text-xs font-bold text-emerald">
          {ORDER_STATUS_LABELS[order.status] ?? order.status}
        </span>
      </div>

      <div className="space-y-4 px-3.5 py-4">
        <section className="space-y-2 rounded-2xl border border-border bg-surface-card p-3.5">
          <h2 className="text-sm font-extrabold text-graphite">Itens do pedido</h2>
          <div className="space-y-2">
            {order.items.map((item, index) => (
              <div key={index} className="text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold text-graphite">
                    {item.quantity}x {item.product_name}
                  </span>
                  <span className="shrink-0 font-bold text-graphite">{formatCurrencyBRL(item.subtotal)}</span>
                </div>
                {item.addons.length > 0 && (
                  <p className="text-xs text-text-muted">{item.addons.map((a) => a.addon_name).join(", ")}</p>
                )}
                {item.observation && <p className="text-xs italic text-text-muted">&ldquo;{item.observation}&rdquo;</p>}
              </div>
            ))}
          </div>
          <div className="space-y-1 border-t border-border pt-2 text-sm">
            <div className="flex justify-between text-text-muted">
              <span>Subtotal</span>
              <span className="font-semibold text-graphite">{formatCurrencyBRL(order.subtotal)}</span>
            </div>
            {order.fulfillment_type === "delivery" && (
              <div className="flex justify-between text-text-muted">
                <span>Taxa de entrega</span>
                <span className="font-semibold text-graphite">{formatCurrencyBRL(order.delivery_fee)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-extrabold text-graphite">
              <span>Total</span>
              <span>{formatCurrencyBRL(order.total)}</span>
            </div>
          </div>
        </section>

        <section className="space-y-1.5 rounded-2xl border border-border bg-surface-card p-3.5">
          <h2 className="text-sm font-extrabold text-graphite">{FULFILLMENT_LABEL[order.fulfillment_type]}</h2>
          {order.fulfillment_type === "delivery" ? (
            <p className="text-sm text-text-muted">
              {order.delivery_street}, {order.delivery_number}
              {order.delivery_complement ? ` - ${order.delivery_complement}` : ""}
              <br />
              {order.delivery_neighborhood} — {order.delivery_city}
              {order.delivery_state ? `/${order.delivery_state}` : ""}
              {order.delivery_reference && (
                <>
                  <br />
                  Referência: {order.delivery_reference}
                </>
              )}
            </p>
          ) : (
            <p className="text-sm text-text-muted">Retire seu pedido diretamente no restaurante.</p>
          )}
        </section>

        <section className="space-y-2 rounded-2xl border border-border bg-surface-card p-3.5">
          <h2 className="text-sm font-extrabold text-graphite">Pagamento</h2>
          <p className="text-sm text-text-muted">{PAYMENT_METHOD_LABELS[order.payment_method]}</p>
          {order.payment_method === "cash" && order.change_for !== null && (
            <p className="text-sm text-text-muted">Troco para {formatCurrencyBRL(order.change_for)}</p>
          )}
          {order.payment_method === "pix" && order.pix_key && (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-surface-subdued px-3 py-2">
              <span className="truncate text-sm font-semibold text-graphite">{order.pix_key}</span>
              <CopyButton value={order.pix_key} label="Copiar chave" copiedLabel="Chave copiada!" />
            </div>
          )}
        </section>

        {order.observation && (
          <section className="space-y-1 rounded-2xl border border-border bg-surface-card p-3.5">
            <h2 className="text-sm font-extrabold text-graphite">Observação</h2>
            <p className="text-sm text-text-muted">{order.observation}</p>
          </section>
        )}

        <div className="flex flex-col gap-2 pt-2">
          <Link
            href={`/loja/${slug}/pedido/${order.public_id}/rastreamento`}
            className="flex h-11 w-full items-center justify-center rounded-xl bg-primary text-sm font-bold text-white"
          >
            Acompanhar pedido
          </Link>
          <Link
            href={`/loja/${slug}`}
            className="flex h-11 w-full items-center justify-center rounded-xl border border-border text-sm font-bold text-graphite"
          >
            Voltar para o cardápio
          </Link>
        </div>
      </div>
    </div>
  );
}
