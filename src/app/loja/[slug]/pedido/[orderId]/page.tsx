import { Check } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPublicOrder, getPublicRestaurantBySlug, formatCurrencyBRL } from "@/lib/store";
import { PAYMENT_METHOD_LABELS } from "@/lib/checkout";
import type { OrderStatus } from "@/lib/orders";
import { CopyButton } from "@/components/loja/CopyButton";
import { OrderStatusBadgeLive } from "@/components/loja/OrderStatusBadge";
import { StoreNotFound } from "@/components/loja/StoreNotFound";

const FULFILLMENT_LABEL: Record<string, string> = { delivery: "Entrega", pickup: "Retirada", counter: "Balcão" };

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
      <div className="flex flex-col items-center gap-2 bg-emerald/10 px-3.5 py-8 text-center md:py-10">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald/20 text-emerald">
          <Check className="h-8 w-8" aria-hidden />
        </span>
        <h1 className="text-headline-md text-graphite md:text-display">Pedido recebido com sucesso!</h1>
        <p className="max-w-md text-body-md text-text-muted">
          Seu pedido foi enviado direto para a cozinha de <span className="font-semibold text-graphite">{order.restaurant_name}</span>.
        </p>
        <p className="mt-1 text-text-muted">
          <span className="text-label-sm uppercase">Pedido</span>{" "}
          <span className="text-headline-md text-primary">#{order.order_number}</span>
        </p>
        <OrderStatusBadgeLive publicId={order.public_id} initialStatus={order.status as OrderStatus} />
      </div>

      <div className="mx-auto grid max-w-5xl items-start gap-4 px-3.5 py-4 lg:grid-cols-2 lg:px-6">
        <section className="space-y-2 rounded-2xl border border-border bg-surface-card p-4 shadow-card">
          <h2 className="text-body-lg font-bold text-graphite">Itens do pedido</h2>
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
            {order.discount_amount > 0 && (
              <div className="flex justify-between text-emerald">
                <span>Cupom ({order.coupon_code})</span>
                <span className="font-semibold">-{formatCurrencyBRL(order.discount_amount)}</span>
              </div>
            )}
            {order.fulfillment_type === "delivery" && (
              <div className="flex justify-between text-text-muted">
                <span>Taxa de entrega</span>
                <span className="font-semibold text-graphite">{formatCurrencyBRL(order.delivery_fee)}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between text-headline-sm text-graphite">
              <span>Total</span>
              <span>{formatCurrencyBRL(order.total)}</span>
            </div>
          </div>
        </section>

        <section className="space-y-1.5 rounded-2xl border border-border bg-surface-card p-4 shadow-card">
          <h2 className="text-body-lg font-bold text-graphite">{FULFILLMENT_LABEL[order.fulfillment_type]}</h2>
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

        <section className="space-y-2 rounded-2xl border border-border bg-surface-card p-4 shadow-card">
          <h2 className="text-body-lg font-bold text-graphite">Pagamento</h2>
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
          <section className="space-y-1 rounded-2xl border border-border bg-surface-card p-4 shadow-card">
            <h2 className="text-body-lg font-bold text-graphite">Observação</h2>
            <p className="text-sm text-text-muted">{order.observation}</p>
          </section>
        )}

        <div className="flex flex-col gap-2 pt-2 lg:col-span-2 lg:mx-auto lg:w-full lg:max-w-md">
          <Link
            href={`/loja/${slug}/pedido/${order.public_id}/rastreamento`}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-primary text-label-lg text-white shadow-[0_8px_20px_-4px_rgba(171,47,0,0.35)] hover:bg-primary-container"
          >
            Acompanhar pedido em tempo real
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
